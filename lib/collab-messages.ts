/** Parse session jsonl tail into chat-friendly messages for collab view. */

export type CollabChatBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; inputPreview?: string }
  | { kind: "toolResult"; name?: string; text: string; isError?: boolean }
  | { kind: "thinking"; text: string };

export type CollabChatMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system" | "meta";
  blocks: CollabChatBlock[];
  timestamp?: string;
};

function previewInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  try {
    const s = JSON.stringify(input);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return undefined;
  }
}

function contentToBlocks(content: unknown, role: string): CollabChatBlock[] {
  if (typeof content === "string") {
    return content.trim() ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: CollabChatBlock[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const type = String(b.type ?? "");
    if (type === "text" && typeof b.text === "string" && b.text.trim()) {
      blocks.push({ kind: "text", text: b.text });
    } else if (type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
      blocks.push({ kind: "thinking", text: b.thinking.slice(0, 400) });
    } else if (type === "toolCall") {
      const name = String(b.toolName || b.name || "tool");
      blocks.push({
        kind: "tool",
        name,
        inputPreview: previewInput(b.input ?? b.arguments),
      });
    } else if (role === "toolResult" || type === "toolResult") {
      const texts = Array.isArray(b.content)
        ? b.content
          .filter((x): x is { type: string; text?: string } => !!x && typeof x === "object")
          .map((x) => (x.type === "text" ? String(x.text ?? "") : ""))
          .filter(Boolean)
          .join("\n")
        : typeof b.content === "string"
          ? b.content
          : "";
      if (texts) {
        blocks.push({
          kind: "toolResult",
          name: typeof b.toolName === "string" ? b.toolName : undefined,
          text: texts.slice(0, 800),
          isError: b.isError === true,
        });
      }
    }
  }
  return blocks;
}

/**
 * Convert raw jsonl lines into ordered chat messages.
 * Keeps the last `maxMessages` message entries.
 */
export function parseCollabChat(lines: string[], maxMessages = 80): CollabChatMessage[] {
  const messages: CollabChatMessage[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(o.type ?? "");
    if (type === "message" && o.message && typeof o.message === "object") {
      const msg = o.message as Record<string, unknown>;
      const roleRaw = String(msg.role ?? "meta");
      const role =
        roleRaw === "user" || roleRaw === "assistant" || roleRaw === "toolResult"
          ? roleRaw
          : roleRaw === "system"
            ? "system"
            : "meta";
      let blocks = contentToBlocks(msg.content, role);
      if (role === "toolResult") {
        // toolResult messages often store text at top-level content array
        const top = contentToBlocks(
          Array.isArray(msg.content) ? msg.content : [{ type: "toolResult", content: msg.content, toolName: msg.toolName, isError: msg.isError }],
          "toolResult",
        );
        blocks = top.length ? top : blocks;
        if (!blocks.length) {
          const fallback = Array.isArray(msg.content)
            ? msg.content.map((c) => (c && typeof c === "object" && (c as { text?: string }).text) || "").join("\n")
            : String(msg.content ?? "");
          if (fallback.trim()) {
            blocks = [{
              kind: "toolResult",
              name: typeof msg.toolName === "string" ? msg.toolName : undefined,
              text: fallback.slice(0, 800),
              isError: msg.isError === true,
            }];
          }
        }
      }
      if (!blocks.length && typeof msg.content === "string" && msg.content.trim()) {
        blocks = [{ kind: "text", text: msg.content }];
      }
      if (!blocks.length) continue;
      messages.push({
        id: String(o.id ?? `${messages.length}`),
        role,
        blocks,
        timestamp: typeof o.timestamp === "string" ? o.timestamp : undefined,
      });
      continue;
    }
    if (type === "session_info" || type === "compaction" || type === "model_change") {
      messages.push({
        id: String(o.id ?? `meta-${messages.length}`),
        role: "meta",
        blocks: [{ kind: "text", text: type === "session_info" && typeof o.name === "string" ? `session: ${o.name}` : type }],
        timestamp: typeof o.timestamp === "string" ? o.timestamp : undefined,
      });
    }
  }
  return messages.slice(-maxMessages);
}
