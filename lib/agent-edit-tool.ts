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

const HASHLINE_GUIDELINES = [
  "Prefer hashline patch language via edit({ input }) — default and most reliable path.",
  "Every section starts with [path#TAG]. TAG is the 4-hex file fingerprint from a fresh read of the file (shown as [path#TAG] / 1:line). Never invent tags.",
  "Ops: SWAP N.=M: (+ body rows), DEL N.=M, INS.PRE N: / INS.POST N: / INS.HEAD: / INS.TAIL: (body rows are +TEXT).",
  "Line numbers refer to the ORIGINAL file snapshot for that tag; do not renumber mid-patch.",
  "On stale-tag rejection: STOP and re-read before further edits.",
  "Classic fallback still works: edit({ path, edits: [{ oldText, newText }] }) — use only when hashline is awkward.",
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
          const results = applyHashlinePatch(cwd, String(args.input));
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

        // 3) Classic path+edits — strict hashline hunks first, then SDK fuzzy classic
        if (isClassicEditArgs(args)) {
          const { path, edits } = normalizeClassicEdits(args);

          // Strict unique exact match via hashline hunks
          try {
            const hunks: HashlineHunk[] = edits.map((e) => ({
              oldText: e.oldText,
              newText: e.newText,
              hash: hashBlock(e.oldText),
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
              // Annotate classic success so UI can still show a mode badge via text
              if (classicResult && typeof classicResult === "object") {
                const details = {
                  ...(classicResult.details ?? {}),
                  mode: "classic-fuzzy",
                };
                return { ...classicResult, details };
              }
              return classicResult;
            } catch (classicError) {
              // Prefer classic error enrichment; mention strict failure if different
              const info = classifyEditFailure(classicError);
              if (info.kind === "aborted") throw classicError;
              const absolutePath = resolveEditPath(cwd, path) ?? (
                info.path ? resolveEditPath(cwd, info.path) : undefined
              );
              let message = formatEditFailureMessage(info, {
                absolutePath,
                oldText: firstOldText({ path, edits }),
              });
              if (strictError instanceof Error && strictError.message !== (classicError instanceof Error ? classicError.message : "")) {
                message += `\n\n(hashline-strict also failed: ${strictError.message})`;
              }
              message += [
                "",
                "Preferred recovery (hashline):",
                "  1. read the file → copy [path#TAG] and line numbers",
                "  2. edit({ input: \"[path#TAG]\\nSWAP N.=M:\\n+new lines\" })",
                "Avoid rewrite-with-write for local changes.",
              ].join("\n");
              const enriched = new Error(message);
              if (classicError instanceof Error && classicError.stack) {
                enriched.stack = `${enriched.stack}\nCaused by: ${classicError.stack}`;
              }
              throw enriched;
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
        // Already enriched classic errors rethrow as-is if they contain "Edit failed"
        if (error instanceof Error && error.message.startsWith("Edit failed")) throw error;
        if (error instanceof Error && /aborted/i.test(error.message)) throw error;

        // Enrich non-classic failures (hashline patch / validation)
        const info = classifyEditFailure(error);
        if (info.kind === "aborted") throw error;

        // For hashline-specific errors, keep the detailed message; still attach excerpt when path known
        const pathGuess =
          resolveEditPath(cwd, args?.path) ??
          (typeof args?.input === "string"
            ? (() => {
                const m = String(args.input).match(/\[(.+?)#[0-9A-Fa-f]{4}\]/);
                return m ? resolveEditPath(cwd, m[1]) : undefined;
              })()
            : undefined) ??
          (info.path ? resolveEditPath(cwd, info.path) : undefined);

        // Stale tag / parse errors already have good text — only wrap generic ones
        if (error instanceof Error && (
          /Stale or wrong tag|Expected section header|Unrecognized hashline|out of bounds|hash mismatch|not unique|not found/i.test(error.message)
        )) {
          throw error;
        }

        const message = formatEditFailureMessage(info, {
          absolutePath: pathGuess,
          oldText: firstOldText(args ?? {}),
        });
        const enriched = new Error(message);
        if (error instanceof Error && error.stack) {
          enriched.stack = `${enriched.stack}\nCaused by: ${error.stack}`;
        }
        throw enriched;
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
