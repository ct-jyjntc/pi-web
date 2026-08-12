/**
 * Derive the current-turn todo overlay from the transcript when no live
 * widget is present. Only the last user message and what follows it count.
 */
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "./types";

export type DerivedTodoItem = {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
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
 * Rebuild the todo list from create / update / list / delete results on the
 * latest user turn (messages after the last user message, plus streaming).
 */
export function deriveTodosFromTranscript(
  messages: AgentMessage[],
  streamingMessage?: AgentMessage | null,
): DerivedTodoItem[] {
  const byId = new Map<number, DerivedTodoItem>();
  let from = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") from = i;
  }
  const turn = messages.slice(from);

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

  for (const msg of turn) {
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
export function formatTodoWidgetLines(
  items: ReadonlyArray<Pick<DerivedTodoItem, "id" | "subject" | "status" | "activeForm">>,
): string[] | null {
  const visible = items.filter((t) => t.status !== "deleted");
  if (visible.length === 0) return null;
  const completed = visible.filter((i) => i.status === "completed").length;
  const lines = [`Todo (${completed}/${visible.length})`];
  visible.forEach((item, index) => {
    const branch = index === visible.length - 1 ? "└─" : "├─";
    const label = item.status === "in_progress" && item.activeForm
      ? `${item.subject} (${item.activeForm})`
      : item.subject;
    lines.push(`${branch} ${glyphFor(item.status)} #${item.id} ${label}`);
  });
  return lines;
}

export function deriveTodoWidgetLines(
  messages: AgentMessage[],
  streamingMessage?: AgentMessage | null,
): string[] | null {
  return formatTodoWidgetLines(deriveTodosFromTranscript(messages, streamingMessage));
}
