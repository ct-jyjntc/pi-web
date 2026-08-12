/**
 * Pi Web write tool — SDK write with workspace-turn journal recording.
 * Single owner for write-path mutation capture (pairs with agent-edit-tool).
 * Successful writes mint [path#TAG] so a follow-up hashline edit does not
 * need a separate read (and cannot omit the tag).
 */
import { existsSync, readFileSync } from "fs";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { computeFileTag } from "./hashline-edit";
import { recordHashlineSnapshot } from "./hashline-snapshots";
import { recordFileMutation } from "./workspace-turn-journal";

export type PiWebWriteToolOptions = {
  getSessionId?: () => string | undefined;
};

type ContentBlock = { type: string; text?: string };

type WriteToolDefinitionLike = {
  name: string;
  description?: string;
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    args: { path: string; content: string },
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: ContentBlock[]; details?: unknown }>;
};

function displayRel(cwd: string, pathValue: string): string {
  const abs = isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

export function createPiWebWriteToolDefinition(
  cwd: string,
  options: PiWebWriteToolOptions = {},
): ReturnType<typeof createWriteToolDefinition> {
  const def = createWriteToolDefinition(cwd, {
    operations: {
      mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
      writeFile: async (absolutePath, content) => {
        let before: string | null = null;
        if (existsSync(absolutePath)) {
          try {
            before = readFileSync(absolutePath, "utf8");
          } catch {
            before = null;
          }
        }
        await fsWriteFile(absolutePath, content, "utf-8");
        const sessionId = options.getSessionId?.();
        if (sessionId) {
          recordFileMutation(sessionId, {
            path: absolutePath,
            kind: before == null ? "create" : "edit",
            before,
            after: content,
          });
        }
      },
    },
  }) as unknown as WriteToolDefinitionLike;

  def.description =
    (def.description ?? "Write content to a file.") +
    " After a successful write the result includes [path#TAG] for a follow-up hashline edit.";
  def.promptGuidelines = [
    ...(def.promptGuidelines ?? []),
    "After write, copy [path#TAG] from the result into edit({ input }). Do not omit the 4-hex tag.",
  ];

  const originalExecute = def.execute;
  def.execute = async (toolCallId, args, signal, onUpdate, ctx) => {
    const result = await originalExecute(toolCallId, args, signal, onUpdate, ctx);
    const path = typeof args?.path === "string" ? args.path : "";
    const content = typeof args?.content === "string" ? args.content : "";
    if (!path) return result;
    const abs = isAbsolute(path) ? path : resolve(cwd, path);
    const onDisk = existsSync(abs) ? readFileSync(abs, "utf8") : content;
    const tag = computeFileTag(onDisk);
    recordHashlineSnapshot(abs, onDisk.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), tag);
    const header = `[${displayRel(cwd, path)}#${tag}]`;
    const blocks = Array.isArray(result.content) ? result.content : [];
    const first = blocks.find((b) => b.type === "text" && typeof b.text === "string");
    const stamp = `${header}\nNext edit: copy this header into edit({ input }). Hashline cannot create files — this path is now editable.`;
    if (first && typeof first.text === "string") {
      first.text = `${first.text}\n${stamp}`;
    } else {
      blocks.push({ type: "text", text: stamp });
    }
    return {
      ...result,
      content: blocks,
      details: {
        ...(typeof result.details === "object" && result.details ? result.details : {}),
        hashlineTag: tag,
      },
    };
  };

  return def as unknown as ReturnType<typeof createWriteToolDefinition>;
}
