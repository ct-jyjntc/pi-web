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
  | { type: "toolcall_start"; contentIndex: number }
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
  const { partial: _partial, ...deltaEvent } = raw as Record<string, unknown>;
  return { type: "message_update", assistantMessageEvent: deltaEvent };
}
