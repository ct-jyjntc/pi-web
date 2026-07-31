/**
 * Derive a todo overlay payload from the transcript when the rpiv-todo
 * extension widget fails to surface (common in Pi Web: package keeps a
 * process-global "foreground session" pointer, so multi-session hosts never
 * re-bind the overlay to the active chat).
 *
 * Parses toolResult text produced by @juicesharp/rpiv-todo.
 */
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "./types";

export type DerivedTodoItem = {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
};

const STATUS_RE = "pending|in[_ ]?progress|completed|deleted";

function textFromToolResult(msg: ToolResultMessage): string {
  return (msg.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function normalizeStatus(raw: string): DerivedTodoItem["status"] {
  const s = raw.toLowerCase().replace(/\s+/g, "_");
  if (s === "in_progress" || s === "inprogress") return "in_progress";
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "deleted" || s === "delete") return "deleted";
  return "pending";
}

function glyphFor(status: DerivedTodoItem["status"]): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "◐";
  if (status === "deleted") return "✗";
  return "○";
}

/**
 * Walk the transcript chronologically and rebuild the latest todo list from
 * create / update / list / delete tool results.
 */
export function deriveTodosFromTranscript(
  messages: AgentMessage[],
  streamingMessage?: AgentMessage | null,
): DerivedTodoItem[] {
  const byId = new Map<number, DerivedTodoItem>();

  const applyText = (text: string) => {
    if (!text.trim()) return;

    // Created #1: subject (pending)
    for (const m of text.matchAll(
      new RegExp(`Created\\s+#(\\d+)\\s*:\\s*(.+?)\\s*\\((${STATUS_RE})\\)`, "gi"),
    )) {
      const id = Number(m[1]);
      byId.set(id, { id, subject: m[2]!.trim(), status: normalizeStatus(m[3]!) });
    }

    // Updated #1 (pending → in_progress)  or  Updated #1 (in_progress → completed)
    for (const m of text.matchAll(
      new RegExp(`Updated\\s+#(\\d+)\\s*\\([^)]*?→\\s*(${STATUS_RE})\\)`, "gi"),
    )) {
      const id = Number(m[1]);
      const prev = byId.get(id);
      const status = normalizeStatus(m[2]!);
      if (prev) byId.set(id, { ...prev, status });
      else byId.set(id, { id, subject: `#${id}`, status });
    }

    // Updated #1: new subject  (subject-only updates — keep status)
    for (const m of text.matchAll(/Updated\s+#(\d+)\s*:\s*(.+)$/gim)) {
      const id = Number(m[1]);
      const subject = m[2]!.trim();
      // Skip if this is a status transition line we already handled
      if (new RegExp(`^(${STATUS_RE})\\b`, "i").test(subject)) continue;
      if (/\(/.test(subject) && /→/.test(subject)) continue;
      const prev = byId.get(id);
      if (prev) byId.set(id, { ...prev, subject });
      else byId.set(id, { id, subject, status: "pending" });
    }

    // List rows: [pending] #1 subject  /  [in_progress] #2 foo
    for (const m of text.matchAll(
      new RegExp(`\\[(${STATUS_RE})\\]\\s*#(\\d+)\\s+(.+)$`, "gim"),
    )) {
      const status = normalizeStatus(m[1]!);
      const id = Number(m[2]);
      const subject = m[3]!.trim().replace(/\s*\(.*?\)\s*$/, "").trim() || m[3]!.trim();
      byId.set(id, { id, subject, status });
    }

    // Deleted #1
    for (const m of text.matchAll(/Deleted\s+#(\d+)/gi)) {
      const id = Number(m[1]);
      const prev = byId.get(id);
      if (prev) byId.set(id, { ...prev, status: "deleted" });
    }

    // Cleared
    if (/\b(cleared|clear all|all tasks cleared)\b/i.test(text) && /todo/i.test(text)) {
      // Only wipe if it looks like a clear command result, not casual prose
      if (/^clear/i.test(text.trim()) || /\bcleared\b/i.test(text) && text.length < 80) {
        byId.clear();
      }
    }
  };

  const consider = (msg: AgentMessage) => {
    if (msg.role !== "toolResult") return;
    const tr = msg as ToolResultMessage;
    // toolName may be missing on some normalizations — also match via nearby assistant toolCalls
    const name = String((tr as { toolName?: string }).toolName ?? "").toLowerCase();
    // Always try parse; Created/Updated patterns are specific enough
    const text = textFromToolResult(tr);
    if (name === "todo" || name === "" || /Created\s+#\d+|Updated\s+#\d+|^\s*\[(pending|in_progress|completed)\]/im.test(text)) {
      if (/Created\s+#\d+|Updated\s+#\d+|Deleted\s+#\d+|\[(pending|in[_ ]?progress|completed|deleted)\]\s*#\d+/i.test(text)) {
        applyText(text);
      }
    }
  };

  // Build toolCallId → toolName map from assistant messages for better filtering
  const toolNames = new Map<string, string>();
  const scanAssistant = (msg: AgentMessage) => {
    if (msg.role !== "assistant") return;
    for (const b of (msg as AssistantMessage).content ?? []) {
      if (b.type === "toolCall") {
        toolNames.set(b.toolCallId, b.toolName);
      }
    }
  };

  for (const msg of messages) {
    scanAssistant(msg);
    if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      const n = toolNames.get(tr.toolCallId)?.toLowerCase();
      if (n && n !== "todo") continue;
      consider(msg);
    }
  }
  if (streamingMessage) {
    scanAssistant(streamingMessage as AgentMessage);
  }

  return [...byId.values()]
    .filter((t) => t.status !== "deleted")
    .sort((a, b) => a.id - b.id);
}

/** Build rpiv-todo-shaped widget lines for the top-bar capsule. */
export function deriveTodoWidgetLines(
  messages: AgentMessage[],
  streamingMessage?: AgentMessage | null,
): string[] | null {
  const items = deriveTodosFromTranscript(messages, streamingMessage);
  if (items.length === 0) return null;

  const completed = items.filter((i) => i.status === "completed").length;
  const total = items.length;
  const lines = [`Todo (${completed}/${total})`];
  items.forEach((item, index) => {
    const branch = index === items.length - 1 ? "└─" : "├─";
    lines.push(`${branch} ${glyphFor(item.status)} #${item.id} ${item.subject}`);
  });
  return lines;
}
