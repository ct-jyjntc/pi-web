/**
 * Pi Web edit tool wrapper — richer failure feedback for the model and UI.
 *
 * Does not change successful edit semantics. On failure, classifies the error,
 * attaches a nearby file excerpt when useful, and rethrows with a recovery guide.
 */
import { isAbsolute, resolve } from "path";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { classifyEditFailure, formatEditFailureMessage } from "./edit-failure";

type EditToolDefinitionLike = {
  name: string;
  promptGuidelines?: string[];
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
  if (!Array.isArray(edits) || edits.length === 0) return undefined;
  const first = edits[0];
  if (!first || typeof first !== "object") return undefined;
  const oldText = (first as { oldText?: unknown }).oldText;
  return typeof oldText === "string" ? oldText : undefined;
}

export function createPiWebEditToolDefinition(
  cwd: string,
): ReturnType<typeof createEditToolDefinition> {
  const def = createEditToolDefinition(cwd) as unknown as EditToolDefinitionLike;

  def.promptGuidelines = [
    ...(def.promptGuidelines ?? []),
    "On edit failure, use the kind/path/excerpt in the error to craft a smaller unique oldText; do not rewrite whole files with write unless necessary.",
  ];

  const originalExecute = def.execute;
  def.execute = async (toolCallId, args, signal, onUpdate, ctx) => {
    try {
      return await originalExecute(toolCallId, args, signal, onUpdate, ctx);
    } catch (error) {
      const info = classifyEditFailure(error);
      if (info.kind === "aborted") throw error;

      const absolutePath = resolveEditPath(cwd, args?.path) ?? (
        info.path ? resolveEditPath(cwd, info.path) : undefined
      );
      const message = formatEditFailureMessage(info, {
        absolutePath,
        oldText: firstOldText(args ?? {}),
      });
      const enriched = new Error(message);
      // Preserve stack for debugging when available.
      if (error instanceof Error && error.stack) {
        enriched.stack = `${enriched.stack}\nCaused by: ${error.stack}`;
      }
      throw enriched;
    }
  };

  return def as unknown as ReturnType<typeof createEditToolDefinition>;
}
