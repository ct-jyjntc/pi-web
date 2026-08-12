/**
 * Conservative hashline apply repair. Single owner for "short SWAP leftover
 * tail": if a SWAP starts on a block opener, ends before the closer, and the
 * authored result is unparsable, widen that SWAP to the resolved block end
 * when — and only when — the widened result parses.
 *
 * This is the existing syntax-gate path (apply → parse → write-or-reject),
 * not a second recovery. We never write unparsable source.
 */
import type { PatchOp } from "./hashline-parse";

export type BlockRange = { start: number; end: number };

export type ExtendShortSwapArgs = {
  lines: string[];
  ops: PatchOp[];
  resolveBlock: (lines: string[], startLine: number) => BlockRange;
  applyOps: (lines: string[], ops: PatchOp[]) => string[];
  joinLines: (lines: string[]) => string;
  isParsable: (text: string) => boolean;
};

function swapLooksLikeFullConstruct(body: string[]): boolean {
  if (body.length === 0) return false;
  const last = (body[body.length - 1] ?? "").trim();
  return /^(?:[)\]}]+[;,]?|<\/>|<\/[A-Za-z][\w.:-]*>|\/>)\s*$/.test(last);
}

/**
 * Return remapped ops + notes when extending short SWAPs restores a parse.
 * Null means "leave the authored reject alone".
 */
export function tryExtendShortSwaps(args: ExtendShortSwapArgs): { ops: PatchOp[]; notes: string[] } | null {
  const candidates: Array<{ index: number; start: number; oldEnd: number; newEnd: number }> = [];

  args.ops.forEach((op, index) => {
    if (op.kind !== "swap") return;
    if (!swapLooksLikeFullConstruct(op.body)) return;
    let block: BlockRange;
    try {
      block = args.resolveBlock(args.lines, op.start);
    } catch {
      return;
    }
    if (block.end > op.end) {
      candidates.push({ index, start: op.start, oldEnd: op.end, newEnd: block.end });
    }
  });

  if (candidates.length === 0) return null;

  const applyExtended = (which: Set<number>): PatchOp[] =>
    args.ops.map((op, index) => {
      if (op.kind !== "swap" || !which.has(index)) return op;
      const hit = candidates.find((c) => c.index === index);
      if (!hit) return op;
      return { ...op, end: hit.newEnd };
    });

  const all = new Set(candidates.map((c) => c.index));
  const trials: Array<{ pick: Set<number>; label: string }> = [
    { pick: all, label: "all" },
    ...candidates.map((c) => ({ pick: new Set([c.index]), label: String(c.index) })),
  ];

  const seen = new Set<string>();
  for (const trial of trials) {
    const key = [...trial.pick].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const nextOps = applyExtended(trial.pick);
    let text: string;
    try {
      text = args.joinLines(args.applyOps(args.lines, nextOps));
    } catch {
      continue;
    }
    if (!args.isParsable(text)) continue;
    const notes = candidates
      .filter((c) => trial.pick.has(c.index))
      .map(
        (c) =>
          `Extended SWAP ${c.start}.=${c.oldEnd} → ${c.start}.=${c.newEnd} ` +
          `(range ended before the construct closer; leftover tail would not parse).`,
      );
    return { ops: nextOps, notes };
  }

  return null;
}
