/**
 * Pi Web edit tool — hashline-first, classic fallback.
 *
 * Preferred (omp-compatible subset):
 *   { input: "[path#TAG]\\nSWAP 10.=12:\\n+new line\\n..." }
 *
 * Also accepted:
 *   { path, edits: [{ oldText, newText }] }           // classic exact replace
 *   { path, hunks: [{ hash?, oldText, newText }] }    // block-hash mode
 *
 * Classic path: try strict hashline hunk apply first, then SDK fuzzy classic edit.
 * Failures get kind/path/excerpt recovery text via edit-failure.ts.
 *
 * @deprecated dual-path — classic `{ path, edits }` is **bugfix-only**.
 * New features must be hashline-only. Removal target: **pi-web 1.0.0** or
 * **2026-12-01** (whichever first), tracked under declutter Phase 2.
 * After removal, keep hashline `input` + optional hunk mode only.
 */
import { Type } from "typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { classifyEditFailure, formatEditFailureMessage } from "./edit-failure";
import {
  checkSourceSyntax,
  formatSyntaxGuardFailure,
} from "./edit-syntax-guard";
import { formatFileOnDisk } from "./format-file";
import {
  applyHashlinePatch,
  collectHashlineLockPaths,
  computeFileTag,
  hashBlock,
  isClassicEditArgs,
  isHashlineHunkArgs,
  isHashlineInputArgs,
  largeFileEditWarning,
  type HashlineHunk,
  type HashlineResult,
} from "./hashline-edit";
import { applyBatchedHashlineEdits, clearBatchedHashlineEdits } from "./hashline-hunk-batch";
import { buildHashlinePreview } from "./hashline-preview";
import {
  recordHashlineSnapshot,
  withHashlinePathsLocked,
} from "./hashline-snapshots";
import { recordFileMutation } from "./workspace-turn-journal";

export type PiWebEditToolOptions = {
  getSessionId?: () => string | undefined;
};

function readTextOrNull(abs: string): string | null {
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function snapshotPaths(paths: string[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const p of paths) {
    if (!p || map.has(p)) continue;
    map.set(p, readTextOrNull(p));
  }
  return map;
}

/** Record before→after for journal after a successful edit (+ optional format). */
function recordSnapshots(
  sessionId: string | undefined,
  beforeMap: Map<string, string | null>,
): void {
  if (!sessionId || beforeMap.size === 0) return;
  for (const [abs, before] of beforeMap) {
    const after = readTextOrNull(abs);
    if (before === after) continue;
    const kind =
      before == null && after != null
        ? "create"
        : after == null
          ? "delete"
          : "edit";
    recordFileMutation(sessionId, { path: abs, kind, before, after });
  }
}

function displayRel(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

/** After prettier/biome, recompute #TAG + preview so the model re-grounds on disk. */
function refreshHashlineAfterFormat(
  cwd: string,
  results: HashlineResult[],
  beforeMap: Map<string, string | null>,
): void {
  for (const r of results) {
    const abs = isAbsolute(r.path) ? r.path : resolve(cwd, r.path);
    if (!existsSync(abs)) continue;
    let after: string;
    try {
      after = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const tag = computeFileTag(after);
    recordHashlineSnapshot(abs, after.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), tag);
    const before = beforeMap.get(abs) ?? "";
    const preview = buildHashlinePreview({
      rel: displayRel(cwd, abs),
      tag,
      before: before ?? "",
      after,
    });
    r.tag = tag;
    r.preview = preview;
    const head = (r.summary ?? `Edited ${displayRel(cwd, abs)}`).split("\n\n")[0] ?? "";
    r.summary = `${head}\n\n${preview}`;
  }
}

type EditToolDefinitionLike = {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: unknown;
  prepareArguments?: (args: Record<string, unknown>) => Record<string, unknown>;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<unknown>;
};

function resolveEditPath(cwd: string, pathValue: unknown): string | undefined {
  if (typeof pathValue !== "string" || !pathValue.trim()) return undefined;
  return isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
}

function firstOldText(args: Record<string, unknown>): string | undefined {
  const edits = args?.edits;
  if (Array.isArray(edits) && edits.length > 0) {
    const first = edits[0];
    if (first && typeof first === "object") {
      const oldText = (first as { oldText?: unknown }).oldText;
      if (typeof oldText === "string") return oldText;
    }
  }
  if (typeof args.oldText === "string") return args.oldText;
  if (Array.isArray(args.hunks) && args.hunks[0] && typeof args.hunks[0] === "object") {
    const oldText = (args.hunks[0] as { oldText?: unknown }).oldText;
    if (typeof oldText === "string") return oldText;
  }
  return undefined;
}

function normalizeClassicEdits(args: Record<string, unknown>): {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
} {
  const path = String(args.path ?? "");
  if (Array.isArray(args.edits) && args.edits.length > 0) {
    return {
      path,
      edits: args.edits.map((e) => {
        const row = e as { oldText?: unknown; newText?: unknown };
        return {
          oldText: String(row.oldText ?? ""),
          newText: String(row.newText ?? ""),
        };
      }),
    };
  }
  return {
    path,
    edits: [{ oldText: String(args.oldText ?? ""), newText: String(args.newText ?? "") }],
  };
}

const HASHLINE_RECOVERY_HINT = [
  "",
  "Preferred recovery (hashline):",
  "  1. Copy [path#TAG] + N:line from the last edit response, or re-read",
  "  2. edit({ input: \"[path#TAG]\\nSWAP N.=M:\\n+new lines\" })",
  "Do not rewrite the file with write unless the change is inherently non-local.",
].join("\n");

/** Single error enricher for classic + hashline failures. */
function enrichEditError(
  cwd: string,
  error: unknown,
  args: Record<string, unknown>,
  options?: { absolutePath?: string; extraNote?: string; appendRecoveryHint?: boolean },
): Error {
  if (error instanceof Error && error.message.startsWith("Edit failed")) return error;
  if (error instanceof Error && /aborted/i.test(error.message)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const info = classifyEditFailure(error);
  if (info.kind === "aborted") {
    return error instanceof Error ? error : new Error(String(error));
  }

  // Hashline / syntax-guard errors already have actionable text.
  if (error instanceof Error && (
    /Stale or wrong tag|Expected section header|Placeholder or invalid tag|Unrecognized hashline|Hashline body lines must start|Edit rejected: would leave unparsable|Invalid line range|out of bounds|hash mismatch|not unique|not found/i.test(error.message)
  )) {
    return error;
  }

  const pathGuess =
    options?.absolutePath
    ?? resolveEditPath(cwd, args?.path)
    ?? (typeof args?.input === "string"
      ? (() => {
          const m = String(args.input).match(/\[(.+?)#[0-9A-Fa-f]{4}\]/);
          return m ? resolveEditPath(cwd, m[1]) : undefined;
        })()
      : undefined)
    ?? (info.path ? resolveEditPath(cwd, info.path) : undefined);

  let message = formatEditFailureMessage(info, {
    absolutePath: pathGuess,
    oldText: firstOldText(args),
  });
  if (options?.extraNote) message += `\n\n${options.extraNote}`;
  if (options?.appendRecoveryHint) message += HASHLINE_RECOVERY_HINT;

  const enriched = new Error(message);
  if (error instanceof Error && error.stack) {
    enriched.stack = `${enriched.stack}\nCaused by: ${error.stack}`;
  }
  return enriched;
}

const HASHLINE_GUIDELINES = [
  "CRITICAL: (1) After every edit, copy [path#NEWTAg] and N:line from THAT response (or re-read). A new TAG does not remap old line numbers. (2) Tight ranges; whole construct = SWAP.BLK N: / PUT N*:. (3) Body is final +TEXT; opener and closer of a wrap belong in the SAME patch.",
  "Section: [path#TAG] then SWAP/DEL/INS (PUT=SWAP, CUT=DEL). Copy TAG from read or the last edit — never invent #XXXX / #TAG.",
  "N.=M is inclusive end from that snapshot, not a count. Do not renumber mid-patch. Batch same-file ops in ONE input.",
  "Stale tag: re-read. JS/TS that would be unparsable is not written — re-read that file before editing others.",
  "On ~800+ line files, extract a module first. Classic { path, edits } is bugfix-only; removal by pi-web 1.0.0 / 2026-12-01.",
];

export function createPiWebEditToolDefinition(
  cwd: string,
  options: PiWebEditToolOptions = {},
): ReturnType<typeof createEditToolDefinition> {
  const classic = createEditToolDefinition(cwd) as unknown as EditToolDefinitionLike;
  const getSessionId = options.getSessionId;

  const def: EditToolDefinitionLike = {
    name: "edit",
    label: "edit",
    description:
      "Edit files. Preferred: hashline { input: \"[path#TAG]\\nSWAP N.=M:\\n+...\" } (PUT/CUT aliases ok). " +
      "Also accepts classic { path, edits } and hunk mode { path, hunks }. " +
      "A successful edit returns [path#NEWTAg] plus N:line rows — copy those for the next call. " +
      "Do not reuse old line numbers with the new TAG. Batch same-file ops in one input.",
    promptSnippet:
      "Make precise file edits (hashline patch language preferred; classic exact replace as fallback)",
    promptGuidelines: HASHLINE_GUIDELINES,
    // Accept both shapes. Models often emit one or the other.
    parameters: Type.Object({
      input: Type.Optional(Type.String({
        description:
          "Hashline patch language (preferred). One or more [path#TAG] sections with SWAP/DEL/INS ops.",
      })),
      path: Type.Optional(Type.String({ description: "File path for classic or hunk mode" })),
      edits: Type.Optional(Type.Array(Type.Object({
        oldText: Type.String(),
        newText: Type.String(),
      }), { description: "Classic exact replacements (fallback)" })),
      oldText: Type.Optional(Type.String({ description: "Legacy single classic edit" })),
      newText: Type.Optional(Type.String({ description: "Legacy single classic edit" })),
      hunks: Type.Optional(Type.Array(Type.Object({
        hash: Type.Optional(Type.String()),
        oldText: Type.String(),
        newText: Type.String(),
      }), { description: "Block-hash anchored replacements" })),
    }),
    prepareArguments: (args) => {
      // Keep classic prepare for path+edits legacy shapes when not using input/hunks
      if (isHashlineInputArgs(args) || isHashlineHunkArgs(args)) return args;
      if (typeof classic.prepareArguments === "function") {
        try {
          return classic.prepareArguments(args);
        } catch {
          return args;
        }
      }
      return args;
    },
    execute: async (toolCallId, args, signal, onUpdate, ctx) => {
      try {
        // Await formatting so the returned #TAG matches on-disk content after prettier/biome.
        const formatEditedFiles = async (paths: Array<string | undefined>) => {
          for (const p of paths) {
            if (!p) continue;
            const abs = isAbsolute(p) ? p : resolve(cwd, p);
            try {
              await formatFileOnDisk(cwd, abs);
            } catch {
              // best-effort
            }
          }
        };

        const mutateLocked = async <T,>(
          paths: string[],
          fn: (beforeMap: Map<string, string | null>) => Promise<T>,
        ): Promise<T> => {
          return withHashlinePathsLocked(paths, async () => {
            const beforeMap = snapshotPaths(paths);
            return fn(beforeMap);
          });
        };

        // 1) Preferred: hashline patch language
        if (isHashlineInputArgs(args)) {
          const input = String(args.input);
          const paths = collectHashlineLockPaths(cwd, input);
          return mutateLocked(paths, async (beforeMap) => {
            for (const p of paths) clearBatchedHashlineEdits(p);
            const results = applyHashlinePatch(cwd, input);
            await formatEditedFiles(results.map((r) => r.path));
            for (const r of results) {
              const abs = isAbsolute(r.path) ? r.path : resolve(cwd, r.path);
              if (!beforeMap.has(abs)) beforeMap.set(abs, null);
            }
            refreshHashlineAfterFormat(cwd, results, beforeMap);
            recordSnapshots(getSessionId?.(), beforeMap);
            const text = results.map((r) => r.summary ?? `Applied ${r.applied} op(s) to ${r.path}`).join("\n\n");
            const patch = results.map((r) => r.patch).filter(Boolean).join("\n") || undefined;
            const tag = results.map((r) => r.tag).filter(Boolean).join(",");
            return {
              content: [{ type: "text", text }],
              details: {
                mode: "hashline-patch",
                tag,
                patch,
                diff: patch,
                results,
              },
            };
          });
        }

        // 2) Hunk mode
        if (isHashlineHunkArgs(args)) {
          const abs = resolveEditPath(cwd, args.path);
          return mutateLocked(abs ? [abs] : [], async (beforeMap) => {
            const hunks = (args.hunks as HashlineHunk[]).map((h) => ({
              ...h,
              hash: h.hash || hashBlock(h.oldText),
            }));
            const result = applyBatchedHashlineEdits(cwd, String(args.path), hunks);
            await formatEditedFiles([result.path]);
            refreshHashlineAfterFormat(cwd, [result], beforeMap);
            recordSnapshots(getSessionId?.(), beforeMap);
            return {
              content: [{
                type: "text",
                text: `${result.summary ?? `Applied ${result.applied} hunk(s)`}\nhashes: ${result.hashes.join(", ")}`,
              }],
              details: {
                mode: "hashline-hunks",
                tag: result.tag,
                patch: result.patch,
                diff: result.diff,
                ...result,
              },
            };
          });
        }

        // 3) Classic path+edits — exact unique match first, then SDK fuzzy classic
        if (isClassicEditArgs(args)) {
          const { path, edits } = normalizeClassicEdits(args);
          const absClassic = resolveEditPath(cwd, path);
          return mutateLocked(absClassic ? [absClassic] : [], async (beforeMap) => {
            try {
              const hunks: HashlineHunk[] = edits.map((e) => ({
                oldText: e.oldText,
                newText: e.newText,
              }));
              const result = applyBatchedHashlineEdits(cwd, path, hunks);
              await formatEditedFiles([result.path]);
              recordSnapshots(getSessionId?.(), beforeMap);
              refreshHashlineAfterFormat(cwd, [result], beforeMap);
              return {
                content: [{
                  type: "text",
                  text:
                    `Successfully replaced ${result.applied} block(s) in ${path} (hashline-strict) → #${result.tag ?? "?"}.` +
                    (result.largeFileWarning ? `\n${result.largeFileWarning}` : "") +
                    (result.preview ? `\n\n${result.preview}` : ""),
                }],
                details: {
                  mode: "classic-via-hashline",
                  tag: result.tag,
                  patch: result.patch,
                  diff: result.diff,
                  ...result,
                },
              };
            } catch (strictError) {
              const strictMsg = strictError instanceof Error ? strictError.message : String(strictError);
              if (/overlap|would leave unparsable/i.test(strictMsg)) throw strictError;
              try {
                const abs = absClassic;
                const before = abs ? beforeMap.get(abs) ?? null : null;
                const classicResult = await classic.execute(
                  toolCallId,
                  { path, edits },
                  signal,
                  onUpdate,
                  ctx,
                ) as { content?: unknown; details?: Record<string, unknown> };
                let sizeNote: string | undefined;
                if (abs && before != null && existsSync(abs)) {
                  const after = readFileSync(abs, "utf8");
                  if (after !== before) {
                    const syntax = checkSourceSyntax(abs, after, cwd);
                    if (!syntax.ok) {
                      writeFileSync(abs, before, "utf8");
                      throw new Error(formatSyntaxGuardFailure(path, syntax));
                    }
                    sizeNote = largeFileEditWarning(path, after);
                  }
                }
                if (classicResult && typeof classicResult === "object") {
                  await formatEditedFiles([abs]);
                  recordSnapshots(getSessionId?.(), beforeMap);
                  if (sizeNote && Array.isArray(classicResult.content)) {
                    const content = classicResult.content as Array<{ type?: string; text?: string }>;
                    const first = content[0];
                    if (first && first.type === "text" && typeof first.text === "string") {
                      first.text = `${first.text}\n${sizeNote}`;
                    }
                  }
                  return {
                    ...classicResult,
                    details: {
                      ...(classicResult.details ?? {}),
                      mode: "classic-fuzzy",
                      largeFileWarning: sizeNote,
                    },
                  };
                }
                await formatEditedFiles([abs]);
                recordSnapshots(getSessionId?.(), beforeMap);
                return classicResult;
              } catch (classicError) {
                const extraNote = strictError instanceof Error
                  && classicError instanceof Error
                  && strictError.message !== classicError.message
                  ? `(hashline-strict also failed: ${strictError.message})`
                  : undefined;
                throw enrichEditError(cwd, classicError, { path, edits }, {
                  absolutePath: resolveEditPath(cwd, path),
                  extraNote,
                  appendRecoveryHint: true,
                });
              }
            }
          });
        }

        throw new Error(
          "edit requires one of:\n" +
            "  • { input: \"[path#TAG]\\nSWAP 10.=10:\\n+...\" }  (preferred hashline)\n" +
            "  • { path, edits: [{ oldText, newText }] }  (classic)\n" +
            "  • { path, hunks: [{ oldText, newText, hash? }] }\n" +
            "Re-read the target file to obtain a fresh #TAG before hashline edits.",
        );
      } catch (error) {
        throw enrichEditError(cwd, error, args ?? {});
      }
    },
  };

  // Preserve classic render hooks if present (for TUI; web may ignore)
  for (const key of ["renderShell", "renderCall", "renderResult"] as const) {
    if (key in classic) {
      (def as Record<string, unknown>)[key] = (classic as Record<string, unknown>)[key];
    }
  }

  return def as unknown as ReturnType<typeof createEditToolDefinition>;
}
