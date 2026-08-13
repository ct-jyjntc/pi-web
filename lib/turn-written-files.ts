/**
 * Paths written/edited in one assistant turn, for chips under the reply.
 */
import type { AssistantMessage, ToolResultMessage } from "@/lib/types";

const WRITE_TOOLS = new Set(["write", "edit"]);

export function turnWrittenFiles(
  message: AssistantMessage,
  toolResults?: Map<string, ToolResultMessage>,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const block of message.content ?? []) {
    if (block.type !== "toolCall") continue;
    if (!WRITE_TOOLS.has(block.toolName)) continue;
    const result = toolResults?.get(block.toolCallId);
    if (result && result.isError) continue;
    const input = block.input ?? {};
    const raw = typeof input.path === "string"
      ? input.path
      : typeof input.file_path === "string"
        ? input.file_path
        : "";
    const path = raw.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}
