/**
 * Live child-transcript stream: file snapshot + parent-hosted child SSE.
 * Does not start an AgentSession on the child file.
 */
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { apiFetch, apiStream, type ApiStream } from "@/lib/api-transport";
import { sendAgentCommand } from "@/lib/agent-client";
import { normalizeToolCalls } from "@/lib/normalize";
import { isHiddenContextMessage } from "@/lib/message-display";
import type { AgentMessage, SessionContext, ToolResultMessage } from "@/lib/types";
import type { ChildTranscriptRequest } from "@/lib/child-transcript-store";
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
} from "@/lib/agent-session-stream-state";
import type { ClientAssistantMessageEvent } from "@/lib/agent-event-wire";
export function useChildAgentStream(request: ChildTranscriptRequest | null) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [streamState, dispatchStream] = useReducer(streamReducer, INITIAL_STREAMING_STATE);
  const eventSourceRef = useRef<ApiStream | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;

  const {
    scrollRef: stickScrollRef,
    contentRef: chatContentRef,
    isAtBottom: stickToBottom,
    scrollToBottom: stickScrollToBottom,
    stopScroll,
  } = useStickToBottom({ initial: "instant", resize: "instant" });
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bindScrollContainer = useCallback((el: HTMLDivElement | null) => {
    stickScrollRef(el);
    scrollContainerRef.current = el;
  }, [stickScrollRef]);

  const applyEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    switch (event.type) {
      case "connected":
        if (event.isStreaming === true) {
          setRunning(true);
          dispatchStream({ type: "start" });
        }
        break;
      case "agent_start":
        setRunning(true);
        dispatchStream({ type: "start" });
        break;
      case "message_start": {
        const startMsg = event.message as AgentMessage | undefined;
        if (startMsg?.role === "assistant") {
          dispatchStream({ type: "snapshot", message: normalizeToolCalls(startMsg) });
        }
        break;
      }
      case "message_update": {
        const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
        if (delta && typeof delta === "object") {
          dispatchStream({ type: "delta", event: delta });
        }
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatchStream({ type: "end" });
        break;
      }
      case "agent_end":
        setRunning(false);
        dispatchStream({ type: "end" });
        break;
      default:
        break;
    }
  }, []);

  const loadContext = useCallback(async (childSessionId: string, parentSessionId: string) => {
    const params = new URLSearchParams({
      parent: parentSessionId,
      deferThinking: "1",
      deferMedia: "1",
    });
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(childSessionId)}?${params}`);
    const data = await res.json() as { context?: SessionContext; error?: string };
    if (!res.ok || !data.context) {
      throw new Error(data.error || "Could not open this subagent transcript");
    }
    setMessages(data.context.messages ?? []);
    setEntryIds(data.context.entryIds ?? []);
  }, []);

  const connect = useCallback((parentSessionId: string, childSessionId: string) => {
    eventSourceRef.current?.close();
    const es = apiStream(
      `/api/agent/${encodeURIComponent(parentSessionId)}/child-events?child=${encodeURIComponent(childSessionId)}`,
    );
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        applyEvent(JSON.parse(event.data) as { type: string; [key: string]: unknown });
      } catch {
        // ignore malformed chunks
      }
    };
  }, [applyEvent]);

  useEffect(() => {
    if (!request) {
      setMessages([]);
      setEntryIds([]);
      setError(null);
      setLoading(false);
      setRunning(false);
      dispatchStream({ type: "end" });
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadContext(request.childSessionId, request.parentSessionId)
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    connect(request.parentSessionId, request.childSessionId);
    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [request?.childSessionId, request?.parentSessionId, loadContext, connect]);

  const send = useCallback(async (text: string) => {
    const current = requestRef.current;
    if (!current) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed, timestamp: Date.now() },
    ]);
    setRunning(true);
    dispatchStream({ type: "start" });
    await sendAgentCommand(current.parentSessionId, {
      type: "subagent_followup",
      childSessionId: current.childSessionId,
      message: trimmed,
    });
    connect(current.parentSessionId, current.childSessionId);
  }, [connect]);

  const abort = useCallback(async () => {
    const current = requestRef.current;
    if (!current) return;
    await sendAgentCommand(current.parentSessionId, {
      type: "subagent_interrupt",
      childSessionId: current.childSessionId,
    });
  }, []);

  const toolResults = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") {
      toolResults.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
    }
  }

  const visible = messages
    .map((message, index) => ({ message, entryId: entryIds[index], index }))
    .filter(({ message }) => message.role !== "toolResult" && !isHiddenContextMessage(message));

  return {
    messages,
    entryIds,
    visible,
    toolResults,
    streamState,
    running,
    loading,
    error,
    send,
    abort,
    stickToBottom,
    resumeStickToBottom: () => {
      void stickScrollToBottom();
    },
    bindScrollContainer,
    scrollContainerRef,
    chatContentRef,
    stopScroll,
  };
}
