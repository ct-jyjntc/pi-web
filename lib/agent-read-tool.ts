/**
 * Wrap the builtin read tool so text outputs include a hashline header +
 * numbered lines the model can copy into edit({ input: "[path#TAG]…" }).
 *
 * Images and error-shaped outputs pass through unchanged.
 */
import { readFileSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { fetchGithubRef, parseGithubRef } from "./github";
import { computeFileTag } from "./hashline-edit";

type ContentBlock = { type: string; text?: string; data?: string; mimeType?: string };

type ReadToolDefinitionLike = {
  name: string;
  description?: string;
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    args: { path: string; offset?: number; limit?: number },
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: ContentBlock[]; details?: unknown }>;
};

function displayPath(cwd: string, pathValue: string): string {
  const abs = isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

/**
 * Rebuild text as:
 *   [rel/path#TAG]
 *   N:line
 * where TAG fingerprints the whole on-disk file (not just the slice).
 */
export function formatReadWithHashline(
  cwd: string,
  pathValue: string,
  text: string,
  offset?: number,
): { text: string; tag: string } {
  // Tag from the full file when possible so edit validation matches.
  let tag = "0000";
  try {
    const abs = isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
    tag = computeFileTag(readFileSync(abs, "utf8"));
  } catch {
    tag = computeFileTag(text);
  }

  const startLine = offset && offset > 0 ? offset : 1;
  // Strip our own prior header if re-read weirdly; strip leading empty
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  // Drop trailing empty from final newline for numbering (same as hashline applier)
  const lines =
    rawLines.length > 0 && rawLines[rawLines.length - 1] === ""
      ? rawLines.slice(0, -1)
      : rawLines;

  // If content already looks numbered (N:...), keep body but still prefix header
  const body = lines.map((line, i) => {
    // Avoid double-numbering if model already saw N: form from us
    if (/^\d+:/.test(line)) return line;
    return `${startLine + i}:${line}`;
  }).join("\n");

  const header = `[${displayPath(cwd, pathValue)}#${tag}]`;
  const footer =
    "\n\n(Hashline: copy the [path#TAG] header into edit({ input }). Line numbers are 1-based anchors for SWAP/DEL/INS.)";
  return { text: `${header}\n${body}${footer}`, tag };
}

export function createPiWebReadToolDefinition(
  cwd: string,
): ReturnType<typeof createReadToolDefinition> {
  const def = createReadToolDefinition(cwd) as unknown as ReadToolDefinitionLike;

  def.description =
    (def.description ?? "Read file contents") +
    " Text files are returned as [path#TAG] plus N:line rows for hashline edit anchors. " +
    "Also supports GitHub virtual paths: pr://N, pr://N/diff, issue://N (requires gh CLI).";
  def.promptGuidelines = [
    ...(def.promptGuidelines ?? []),
    "Text reads include a [path#TAG] header and N:line rows — use that TAG and those line numbers with edit({ input }) hashline patches.",
    "After any successful edit, re-read before further hashline edits (TAG changes).",
    "For GitHub PRs/issues use read path pr://N or issue://N (or the github tool).",
  ];

  const originalExecute = def.execute;
  def.execute = async (toolCallId, args, signal, onUpdate, ctx) => {
    // Virtual GitHub refs — never hit the filesystem.
    const path = typeof args?.path === "string" ? args.path : "";
    const ghRef = path ? parseGithubRef(path) : null;
    if (ghRef) {
      const fetched = await fetchGithubRef(cwd, ghRef);
      return {
        content: [{ type: "text", text: fetched.text }],
        details: { github: true, ref: ghRef, ...(typeof fetched.details === "object" && fetched.details ? fetched.details as object : {}) },
        ...(fetched.ok ? {} : { isError: true }),
      };
    }

    const result = await originalExecute(toolCallId, args, signal, onUpdate, ctx);
    try {
      const blocks = Array.isArray(result.content) ? result.content : [];
      const hasImage = blocks.some((b) => b.type === "image");
      if (hasImage) return result;

      const textBlocks = blocks.filter((b) => b.type === "text" && typeof b.text === "string");
      if (textBlocks.length === 0) return result;

      // Only rewrite pure text reads (single text block is the common case)
      const first = textBlocks[0]!;
      if (!path || !first.text) return result;

      // Skip error-like / special messages
      if (
        first.text.startsWith("[Line ") ||
        first.text.startsWith("Read image") ||
        first.text.startsWith("Offset ")
      ) {
        return result;
      }

      const { text, tag } = formatReadWithHashline(cwd, path, first.text, args?.offset);
      const rest = blocks.filter((b) => b !== first);
      return {
        ...result,
        content: [{ type: "text", text }, ...rest],
        details: {
          ...(typeof result.details === "object" && result.details ? result.details : {}),
          hashlineTag: tag,
        },
      };
    } catch {
      return result;
    }
  };

  return def as unknown as ReturnType<typeof createReadToolDefinition>;
}
