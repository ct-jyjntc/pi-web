/**
 * Streaming bubble reducer and SSE connection error type for the agent session hook.
 */

import type { AgentMessage } from "@/lib/types";
import { type ApiStream } from "@/lib/api-transport";

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

export type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
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
