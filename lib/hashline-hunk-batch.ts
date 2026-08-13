/**
 * Same-path classic/hunk batch. Parallel edit({ path, oldText, newText })
 * calls each syntax-check alone and reject incomplete JSX wraps. While the
 * path lock still has waiters, stash hunks that matched but did not parse;
 * the next call on that path applies pending + new together. Queue drain
 * drops the stash so a later turn cannot replay them.
 */
import { isAbsolute, resolve } from "path";
import { applyHashlineEdits, type HashlineHunk, type HashlineResult } from "./hashline-edit";
import { registerHashlinePathIdleHook } from "./hashline-snapshots";

const pendingByPath = new Map<string, HashlineHunk[]>();

registerHashlinePathIdleHook((abs) => {
  pendingByPath.delete(abs);
});

function resolveAbs(cwd: string, pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
}

export function clearBatchedHashlineEdits(absPath?: string): void {
  if (absPath) pendingByPath.delete(absPath);
  else pendingByPath.clear();
}

export function pendingBatchedHunkCount(absPath: string): number {
  return pendingByPath.get(absPath)?.length ?? 0;
}

/**
 * Apply classic/hunk replacements, combining any same-path hunks that
 * already matched in this lock queue but failed the syntax gate.
 */
export function applyBatchedHashlineEdits(
  cwd: string,
  pathValue: string,
  hunks: HashlineHunk[],
): HashlineResult {
  const abs = resolveAbs(cwd, pathValue);
  const pending = pendingByPath.get(abs) ?? [];
  const combined = pending.length > 0 ? [...pending, ...hunks] : hunks;
  try {
    const result = applyHashlineEdits(cwd, pathValue, combined);
    pendingByPath.delete(abs);
    if (pending.length > 0) {
      result.summary =
        `${result.summary ?? `Applied ${result.applied} hunk(s)`}\n` +
        `Applied ${pending.length} earlier same-file hunk(s) from this turn together with this call.`;
    }
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (pending.length > 0 && /oldText not found/i.test(msg)) {
      pendingByPath.delete(abs);
      return applyHashlineEdits(cwd, pathValue, hunks);
    }
    if (/would leave unparsable/i.test(msg)) {
      pendingByPath.set(abs, combined);
      const extra =
        combined.length > hunks.length
          ? `\nHeld ${combined.length} hunk(s) on this path for the next same-file edit in this turn (opener/closer splits must land together).`
          : `\nThis replacement matched but does not parse alone. Later same-file edits in this turn will be applied together with it. Prefer one edit({ path, edits: [...] }) or one hashline input.`;
      throw new Error(`${msg}${extra}`);
    }
    throw error;
  }
}
