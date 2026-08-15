/** Append error toolResults for the trailing open tool-call batch. */
import { normalizeToolCalls } from "./normalize";
import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";

export const INTERRUPTED_TOOL_RESULT_TEXT =
  "Tool did not finish (session interrupted).";

export function shouldRepairOnOpen(opts: { alive: boolean }): boolean {
  return !opts.alive;
}

export function buildInterruptedToolResult(toolCallId: string, toolName: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    isError: true,
    timestamp: Date.now(),
    content: [{ type: "text", text: INTERRUPTED_TOOL_RESULT_TEXT }],
  };
}

export function unmatchedToolCallsOnTrailingAssistant(
  messages: AgentMessage[],
): Array<{ toolCallId: string; toolName: string }> {
  const msgs = messages.map((m) => normalizeToolCalls(m));
  let lastAssistantIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i]?.role === "assistant") lastAssistantIdx = i;
  }
  if (lastAssistantIdx < 0) return [];
  const assistant = msgs[lastAssistantIdx] as AssistantMessage;
  const stop = assistant.stopReason;
  if (stop === "aborted" || stop === "error") return [];
  for (let i = lastAssistantIdx + 1; i < msgs.length; i++) {
    if (msgs[i]?.role !== "toolResult") return [];
  }
  const closed = new Set<string>();
  for (let i = lastAssistantIdx + 1; i < msgs.length; i++) {
    const m = msgs[i];
    if (m?.role === "toolResult" && m.toolCallId) closed.add(m.toolCallId);
  }
  const out: Array<{ toolCallId: string; toolName: string }> = [];
  for (const block of assistant.content ?? []) {
    if (block.type !== "toolCall") continue;
    const tc = block as ToolCallContent;
    if (!tc.toolCallId || closed.has(tc.toolCallId)) continue;
    out.push({ toolCallId: tc.toolCallId, toolName: tc.toolName || "unknown" });
  }
  return out;
}

export function applyRepairToMessages(messages: AgentMessage[]): {
  persist: ToolResultMessage[];
  nextMessages: AgentMessage[];
} {
  const persist = unmatchedToolCallsOnTrailingAssistant(messages).map((c) =>
    buildInterruptedToolResult(c.toolCallId, c.toolName),
  );
  return { persist, nextMessages: persist.length ? [...messages, ...persist] : messages };
}
