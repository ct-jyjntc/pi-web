/**
 * Client-facing agent event projection. In-process SDK events still carry
 * full snapshots; SSE must send linear deltas (Pi 0.84+ JSON/RPC shape).
 */
export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

export type ClientAssistantMessageEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; content: string }
  | { type: "toolcall_start"; contentIndex: number; id?: string; toolName?: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: {
      type: "toolCall";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    } }
  | { type: string; [key: string]: unknown };

export function toClientAgentEvent(event: AgentEventLike): AgentEventLike | null {
  if (event.type === "turn_start" || event.type === "turn_end" || event.type === "tool_execution_update") {
    return null;
  }
  if (event.type !== "message_update") return event;

  const raw = event.assistantMessageEvent;
  if (!raw || typeof raw !== "object") return null;
  const { partial, ...deltaEvent } = raw as Record<string, unknown>;
  // SSE strips the growing `partial` snapshot. toolcall_start only carries
  // id/name inside that snapshot — lift them onto the linear delta.
  if (deltaEvent.type === "toolcall_start") {
    liftToolcallStart(deltaEvent, partial);
  }
  return { type: "message_update", assistantMessageEvent: deltaEvent };
}

function liftToolcallStart(delta: Record<string, unknown>, partial: unknown): void {
  if (typeof delta.id === "string" && delta.id && typeof delta.toolName === "string" && delta.toolName) return;
  if (!partial || typeof partial !== "object") return;
  const index = typeof delta.contentIndex === "number" ? delta.contentIndex : -1;
  const content = (partial as { content?: unknown }).content;
  const block = Array.isArray(content) ? content[index] : undefined;
  if (!block || typeof block !== "object") return;
  const rec = block as Record<string, unknown>;
  if (typeof delta.id !== "string" || !delta.id) {
    if (typeof rec.id === "string" && rec.id) delta.id = rec.id;
    else if (typeof rec.toolCallId === "string" && rec.toolCallId) delta.id = rec.toolCallId;
  }
  if (typeof delta.toolName !== "string" || !delta.toolName) {
    if (typeof rec.name === "string" && rec.name) delta.toolName = rec.name;
    else if (typeof rec.toolName === "string" && rec.toolName) delta.toolName = rec.toolName;
  }
}
