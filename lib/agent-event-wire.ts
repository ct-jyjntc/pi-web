/**
 * Client-facing agent event projection. In-process SDK events still carry
 * full snapshots; SSE must send linear deltas (Pi 0.84+ JSON/RPC shape).
 */
import { presenterFor, type ToolPresentation } from "./tool-presentation";
import { isRecord } from "./type-guards";

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
  | { type: "toolcall_start"; contentIndex: number; id?: string; toolName?: string; presentation?: ToolPresentation }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: {
      type: "toolCall";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }; presentation?: ToolPresentation }
  | { type: string; [key: string]: unknown };

export function toClientAgentEvent(event: AgentEventLike): AgentEventLike | null {
  if (event.type === "turn_start" || event.type === "turn_end") {
    return null;
  }
  if (event.type === "message_end") {
    return attachMessageEndPresentation(event);
  }
  if (event.type === "tool_execution_update") {
    // High-frequency progress events: forward only the slim shape, drop bulky args.
    return {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      partialResult: event.partialResult,
    };
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
  const presentation = presentationForDelta(deltaEvent);
  if (presentation) deltaEvent.presentation = presentation;
  return { type: "message_update", assistantMessageEvent: deltaEvent };
}

function presentationForDelta(delta: Record<string, unknown>): ToolPresentation | undefined {
  const toolCall = isRecord(delta.toolCall) ? delta.toolCall : undefined;
  const name = typeof delta.toolName === "string" && delta.toolName
    ? delta.toolName
    : (typeof toolCall?.name === "string" ? toolCall.name : "");
  if (!name) return undefined;
  try {
    if (delta.type === "toolcall_end") {
      const args = isRecord(toolCall?.arguments) ? toolCall.arguments : {};
      return presenterFor(name).presentCall(args);
    }
    if (delta.type === "toolcall_start") {
      return presenterFor(name).presentCall({});
    }
  } catch {
    // One presenter must not fail the whole hydrate.
    return { card: "generic", title: name };
  }
  return undefined;
}

function attachMessageEndPresentation(event: AgentEventLike): AgentEventLike {
  const message = event.message;
  if (!isRecord(message)) return event;
  if (message.role === "toolResult") return attachToolResultPresentation(event, message);
  if (message.role === "assistant") return attachAssistantPresentCall(event, message);
  return event;
}

function attachAssistantPresentCall(
  event: AgentEventLike,
  message: Record<string, unknown>,
): AgentEventLike {
  const content = message.content;
  if (!Array.isArray(content)) return event;
  let changed = false;
  const nextContent = content.map((block) => {
    if (!isRecord(block) || block.type !== "toolCall") return block;
    const name = typeof block.toolName === "string" && block.toolName
      ? block.toolName
      : (typeof block.name === "string" ? block.name : "");
    if (!name) return block;
    const args = isRecord(block.input)
      ? block.input
      : (isRecord(block.arguments) ? block.arguments : {});
    let presentation: ToolPresentation;
    try {
      presentation = presenterFor(name).presentCall(args);
    } catch {
      // One presenter must not fail the whole hydrate.
      presentation = { card: "generic", title: name };
    }
    changed = true;
    return { ...block, presentation };
  });
  if (!changed) return event;
  return { ...event, message: { ...message, content: nextContent } };
}

function attachToolResultPresentation(
  event: AgentEventLike,
  message: Record<string, unknown>,
): AgentEventLike {
  const toolName = typeof message.toolName === "string" ? message.toolName : "";
  if (!toolName) return event;
  // Missing args still run presentResult so patch/card can land; title merge is on copy.
  const args = isRecord(message.arguments)
    ? message.arguments
    : (isRecord(message.input) ? message.input : {});
  let presentation: ToolPresentation;
  try {
    presentation = presenterFor(toolName).presentResult(args, {
      content: Array.isArray(message.content) ? message.content as Array<{ type: string; text?: string }> : [],
      details: message.details,
      isError: message.isError === true,
    });
  } catch {
    // One presenter must not fail the whole hydrate.
    presentation = { card: "generic", title: toolName };
  }
  return { ...event, message: { ...message, presentation } };
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
