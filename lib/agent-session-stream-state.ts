/**
 * Streaming bubble reducer and SSE connection error type for the agent session hook.
 */
import type { AgentMessage, AssistantContentBlock, AssistantMessage, ToolCallContent } from "@/lib/types";
import { type ApiStream } from "@/lib/api-transport";
import type { ClientAssistantMessageEvent } from "@/lib/agent-event-wire";

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

export type StreamAction =
  | { type: "start" }
  | { type: "snapshot"; message: AgentMessage }
  | { type: "delta"; event: ClientAssistantMessageEvent }
  | { type: "end" };

export const INITIAL_STREAMING_STATE: StreamingState = {
  isStreaming: false,
  streamingMessage: null,
};

function asAssistant(message: Partial<AgentMessage> | null): AssistantMessage | null {
  if (!message || message.role !== "assistant") return null;
  return message as AssistantMessage;
}

function ensureBlock(
  message: AssistantMessage,
  index: number,
  block: AssistantContentBlock,
): AssistantMessage {
  const content = message.content ? message.content.slice() : [];
  while (content.length <= index) content.push({ type: "text", text: "" });
  content[index] = block;
  return { ...message, content };
}

export function applyAssistantDelta(
  state: StreamingState,
  event: ClientAssistantMessageEvent,
): StreamingState {
  const base = asAssistant(state.streamingMessage) ?? {
    role: "assistant" as const,
    content: [] as AssistantContentBlock[],
    model: "",
    provider: "",
  };
  const index = "contentIndex" in event && typeof event.contentIndex === "number" ? event.contentIndex : 0;

  switch (event.type) {
    case "text_start":
      return { isStreaming: true, streamingMessage: ensureBlock(base, index, { type: "text", text: "" }) };
    case "text_delta": {
      const prev = base.content[index];
      const text = prev?.type === "text" ? prev.text : "";
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, { type: "text", text: text + String(event.delta ?? "") }),
      };
    }
    case "text_end":
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, { type: "text", text: String(event.content ?? "") }),
      };
    case "thinking_start":
      return { isStreaming: true, streamingMessage: ensureBlock(base, index, { type: "thinking", thinking: "" }) };
    case "thinking_delta": {
      const prev = base.content[index];
      const thinking = prev?.type === "thinking" ? prev.thinking : "";
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, {
          type: "thinking",
          thinking: thinking + String(event.delta ?? ""),
        }),
      };
    }
    case "thinking_end":
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, { type: "thinking", thinking: String(event.content ?? "") }),
      };
    case "toolcall_start": {
      const rec = event as { id?: unknown; toolCallId?: unknown; toolName?: unknown; name?: unknown; presentation?: unknown };
      const id = typeof rec.id === "string" && rec.id
        ? rec.id
        : (typeof rec.toolCallId === "string" ? rec.toolCallId : "");
      const toolName = typeof rec.toolName === "string" && rec.toolName
        ? rec.toolName
        : (typeof rec.name === "string" ? rec.name : "");
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, {
          type: "toolCall",
          toolCallId: id,
          toolName,
          input: {},
          ...("presentation" in event ? { presentation: event.presentation as ToolCallContent["presentation"] } : {}),
        }),
      };
    }
    case "toolcall_delta": {
      const prev = base.content[index];
      const prevInput = prev?.type === "toolCall" ? prev.input : {};
      const prevRaw = typeof prevInput.__raw === "string" ? prevInput.__raw : "";
      const raw = prevRaw + String(event.delta ?? "");
      let input: Record<string, unknown> = { ...prevInput, __raw: raw };
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        // Partial JSON — keep the draft until toolcall_end.
      }
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, {
          type: "toolCall",
          toolCallId: prev?.type === "toolCall" ? prev.toolCallId : "",
          toolName: prev?.type === "toolCall" ? prev.toolName : "",
          input,
          ...(prev?.type === "toolCall" && prev.presentation ? { presentation: prev.presentation } : {}),
        }),
      };
    }
    case "toolcall_end": {
      const prev = base.content[index];
      const toolCall = event.toolCall as { id?: string; name?: string; arguments?: Record<string, unknown> } | undefined;
      const fallback = prev?.type === "toolCall" ? prev : null;
      const input = { ...(toolCall?.arguments ?? fallback?.input ?? {}) };
      delete input.__raw;
      const presentation = "presentation" in event && event.presentation
        ? event.presentation as ToolCallContent["presentation"]
        : fallback?.presentation;
      return {
        isStreaming: true,
        streamingMessage: ensureBlock(base, index, {
          type: "toolCall",
          toolCallId: String(toolCall?.id ?? fallback?.toolCallId ?? ""),
          toolName: String(toolCall?.name ?? fallback?.toolName ?? ""),
          input,
          ...(presentation ? { presentation } : {}),
        }),
      };
    }
    default:
      return state.isStreaming ? state : { ...state, isStreaming: true };
  }
}

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "snapshot":
      return { isStreaming: true, streamingMessage: action.message };
    case "delta":
      return applyAssistantDelta(state, action.event);
    case "end":
      return INITIAL_STREAMING_STATE;
    default:
      return state;
  }
}

export type EventStreamConnectionStatus = "connected" | "timeout" | "closed";

export type EventStreamConnectionResult = {
  status: EventStreamConnectionStatus;
  source: ApiStream;
};

export class EventStreamConnectionError extends Error {
  constructor(public readonly status: Exclude<EventStreamConnectionStatus, "connected">) {
    super(status === "timeout" ? "agent.sseTimeout" : "agent.sseFailed");
    this.name = "EventStreamConnectionError";
  }
}
