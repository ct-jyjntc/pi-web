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
import { isAbsolute, resolve } from "path";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { classifyEditFailure, formatEditFailureMessage } from "./edit-failure";
import {
  applyHashlineEdits,
  applyHashlinePatch,
  hashBlock,
  isClassicEditArgs,
  isHashlineHunkArgs,
  isHashlineInputArgs,
  type HashlineHunk,
} from "./hashline-edit";

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
  "  1. read the file → copy [path#TAG] and line numbers",
  "  2. edit({ input: \"[path#TAG]\\nSWAP N.=M:\\n+new lines\" })",
  "Avoid rewrite-with-write for local changes.",
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

  // Hashline-specific errors already have actionable text.
  if (error instanceof Error && (
    /Stale or wrong tag|Expected section header|Placeholder or invalid tag|Unrecognized hashline|Invalid line range|out of bounds|hash mismatch|not unique|not found/i.test(error.message)
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
  "Prefer hashline patch language via edit({ input }) — default and most reliable path.",
  "Every section starts with [path#TAG]. TAG is the 4-hex file fingerprint from a fresh read (shown as [path#TAG] / 1:line). Copy it exactly — never invent #XXXX / #TAG placeholders.",
  "Ops: SWAP N.=M: (+ body rows), DEL N.=M, INS.PRE N: / INS.POST N: / INS.HEAD: / INS.TAIL: (body rows are +TEXT).",
  "N.=M means inclusive start..end line numbers from the read output (e.g. lines 10-12 → SWAP 10.=12:). M is NOT a line count.",
  "Line numbers refer to the ORIGINAL file snapshot for that tag; do not renumber mid-patch.",
  "On stale-tag rejection: STOP and re-read before further edits.",
  "Classic fallback still works: edit({ path, edits: [{ oldText, newText }] }) — bugfix-only; deprecated dual-path, removal by pi-web 1.0.0 / 2026-12-01.",
  "When changing multiple separate locations in one file, prefer one edit call with multiple ops/sections.",
  "On edit failure, use the kind/path/excerpt/tag in the error to craft a smaller unique anchor; do not rewrite whole files with write unless necessary.",
];

export function createPiWebEditToolDefinition(
  cwd: string,
): ReturnType<typeof createEditToolDefinition> {
  const classic = createEditToolDefinition(cwd) as unknown as EditToolDefinitionLike;

  const def: EditToolDefinitionLike = {
    name: "edit",
    label: "edit",
    description:
      "Edit files. Preferred: hashline patch language via { input: \"[path#TAG]\\nSWAP N.=M:\\n+...\" }. " +
      "Also accepts classic { path, edits: [{ oldText, newText }] } and hunk mode { path, hunks }. " +
      "TAG is a 4-hex fingerprint of the whole file — re-read after every successful edit.",
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
        // 1) Preferred: hashline patch language
        if (isHashlineInputArgs(args)) {
          const input = String(args.input);
          const results = applyHashlinePatch(cwd, input);
          const text = results.map((r) => r.summary ?? `Applied ${r.applied} op(s) to ${r.path}`).join("\n");
          // Prefer first file's patch for the chat SplitPatchView; multi-file still in results.
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
        }

        // 2) Hunk mode
        if (isHashlineHunkArgs(args)) {
          const hunks = (args.hunks as HashlineHunk[]).map((h) => ({
            ...h,
            hash: h.hash || hashBlock(h.oldText),
          }));
          const result = applyHashlineEdits(cwd, String(args.path), hunks);
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
        }

        // 3) Classic path+edits — exact unique match first, then SDK fuzzy classic
        if (isClassicEditArgs(args)) {
          const { path, edits } = normalizeClassicEdits(args);

          // Exact unique replace (no self-computed hash — hash would always match).
          try {
            const hunks: HashlineHunk[] = edits.map((e) => ({
              oldText: e.oldText,
              newText: e.newText,
            }));
            const result = applyHashlineEdits(cwd, path, hunks);
            return {
              content: [{
                type: "text",
                text: `Successfully replaced ${result.applied} block(s) in ${path} (hashline-strict) → #${result.tag ?? "?"}.`,
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
            // Fall back to SDK classic (fuzzy whitespace tolerance)
            try {
              const classicResult = await classic.execute(
                toolCallId,
                { path, edits },
                signal,
                onUpdate,
                ctx,
              ) as { content?: unknown; details?: Record<string, unknown> };
              if (classicResult && typeof classicResult === "object") {
                return {
                  ...classicResult,
                  details: {
                    ...(classicResult.details ?? {}),
                    mode: "classic-fuzzy",
                  },
                };
              }
              return classicResult;
            } catch (classicError) {
              const strictNote = strictError instanceof Error
                && classicError instanceof Error
                && strictError.message !== classicError.message
                ? `(hashline-strict also failed: ${strictError.message})`
                : undefined;
              throw enrichEditError(cwd, classicError, { path, edits }, {
                absolutePath: resolveEditPath(cwd, path),
                extraNote: strictNote,
                appendRecoveryHint: true,
              });
            }
          }
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
