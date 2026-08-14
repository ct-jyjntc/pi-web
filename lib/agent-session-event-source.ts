/**
 * Browser EventSource open/reconnect + post-settle idle grace for agent SSE.
 * Does not own finish/settle — only kicks settlement on reconnect give-up.
 */

import type { AgentStateResponse } from "@/lib/agent-session-live-apply";
import type { AgentPhase } from "@/lib/agent-session-phase";
import {
  EventStreamConnectionError,
  type EventStreamConnectionResult,
  type EventStreamConnectionStatus,
} from "@/lib/agent-session-stream-state";
import {
  EVENT_STREAM_CONNECT_TIMEOUT_MS,
  EVENT_STREAM_IDLE_GRACE_MS,
  EVENT_STREAM_RECONNECT_BASE_MS,
  EVENT_STREAM_RECONNECT_MAX_ATTEMPTS,
  EVENT_STREAM_RECONNECT_MAX_MS,
  PROMPT_SETTLE_POLL_MS,
} from "@/lib/agent-run-lifecycle";
import { API_STREAM_CLOSED, apiFetch, apiStream, type ApiStream } from "@/lib/api-transport";

export type AgentEventSourceContext = {
  eventSourceRef: { current: ApiStream | null };
  sessionIdRef: { current: string | null };
  agentRunningRef: { current: boolean };
  abortRequestedRef: { current: boolean };
  mountedRef: { current: boolean };
  promptRunIdRef: { current: number };
  sseReconnectAttemptRef: { current: number };
  sseReconnectTimerRef: { current: ReturnType<typeof setTimeout> | null };
  eventStreamGraceTimerRef: { current: ReturnType<typeof setTimeout> | null };
  eventStreamGraceGenerationRef: { current: number };
  eventStreamGraceActiveRef: { current: boolean };
  waitForPromptSettlementRef: { current: ((sid: string, runId?: number) => Promise<void>) | null };
  handleAgentEventRef: { current: ((event: { type: string; [key: string]: unknown }) => void) | null };

  setAgentRunning: (v: boolean) => void;
  setAgentPhase: (v: AgentPhase) => void;
  setIsCompacting: (v: boolean) => void;
};

export function cancelEventStreamGrace(ctx: AgentEventSourceContext): void {
  ctx.eventStreamGraceGenerationRef.current += 1;
  ctx.eventStreamGraceActiveRef.current = false;
  if (ctx.eventStreamGraceTimerRef.current) {
    clearTimeout(ctx.eventStreamGraceTimerRef.current);
    ctx.eventStreamGraceTimerRef.current = null;
  }
}

export function closeEventSource(ctx: AgentEventSourceContext): void {
  cancelEventStreamGrace(ctx);
  if (ctx.sseReconnectTimerRef.current) {
    clearTimeout(ctx.sseReconnectTimerRef.current);
    ctx.sseReconnectTimerRef.current = null;
  }
  ctx.eventSourceRef.current?.close();
  ctx.eventSourceRef.current = null;
}

export function scheduleEventStreamClose(ctx: AgentEventSourceContext, sid: string): void {
  cancelEventStreamGrace(ctx);
  ctx.eventStreamGraceActiveRef.current = true;
  const generation = ctx.eventStreamGraceGenerationRef.current;

  const finalizeClose = () => {
    if (
      generation !== ctx.eventStreamGraceGenerationRef.current
      || ctx.sessionIdRef.current !== sid
      || !ctx.eventStreamGraceActiveRef.current
    ) return;
    ctx.eventStreamGraceActiveRef.current = false;
    ctx.eventStreamGraceTimerRef.current = null;
    // Soft close: do not cancel grace again (already done).
    if (ctx.sseReconnectTimerRef.current) {
      clearTimeout(ctx.sseReconnectTimerRef.current);
      ctx.sseReconnectTimerRef.current = null;
    }
    ctx.eventSourceRef.current?.close();
    ctx.eventSourceRef.current = null;
  };

  const checkServerIdle = async () => {
    if (
      generation !== ctx.eventStreamGraceGenerationRef.current
      || ctx.sessionIdRef.current !== sid
      || !ctx.eventStreamGraceActiveRef.current
    ) return;

    try {
      const res = await apiFetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      if (
        generation !== ctx.eventStreamGraceGenerationRef.current
        || ctx.sessionIdRef.current !== sid
        || !ctx.eventStreamGraceActiveRef.current
      ) return;

      const state = data.state;
      const promptActive = Boolean(data.running && state && (state.isStreaming || state.isPromptRunning));
      if (promptActive && !ctx.abortRequestedRef.current) {
        // Late work started (extension / queue) — revive UI running state.
        ctx.eventStreamGraceActiveRef.current = false;
        ctx.eventStreamGraceTimerRef.current = null;
        ctx.agentRunningRef.current = true;
        ctx.setAgentRunning(true);
        ctx.setAgentPhase(state?.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
        return;
      }

      if (data.running && state?.isCompacting && !ctx.abortRequestedRef.current) {
        ctx.setIsCompacting(true);
        ctx.eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
        return;
      }
    } catch {
      // Network blip during grace — still close after the timer fires.
    }

    // Still idle after the grace window: drop the SSE.
    ctx.eventStreamGraceTimerRef.current = setTimeout(finalizeClose, 0);
  };

  ctx.eventStreamGraceTimerRef.current = setTimeout(() => {
    void checkServerIdle();
  }, EVENT_STREAM_IDLE_GRACE_MS);
}

export function connectEventSource(
  ctx: AgentEventSourceContext,
  sid: string,
): Promise<EventStreamConnectionResult> {
  // New connection cancels any pending idle-grace close.
  cancelEventStreamGrace(ctx);
  if (ctx.sseReconnectTimerRef.current) {
    clearTimeout(ctx.sseReconnectTimerRef.current);
    ctx.sseReconnectTimerRef.current = null;
  }
  ctx.eventSourceRef.current?.close();
  ctx.eventSourceRef.current = null;
  const es = apiStream(`/api/agent/${encodeURIComponent(sid)}/events`);
  ctx.eventSourceRef.current = es;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (status: EventStreamConnectionStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status, source: es });
    };
    const timeout = setTimeout(() => settle("timeout"), EVENT_STREAM_CONNECT_TIMEOUT_MS);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; [key: string]: unknown };
        if (event.type === "connected") {
          ctx.sseReconnectAttemptRef.current = 0;
          settle("connected");
        }
        ctx.handleAgentEventRef.current?.(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      if (es.readyState === API_STREAM_CLOSED) {
        // Fatal error (404/500/content-type mismatch): browser won't
        // auto-reconnect. Settle the Promise and manually reconnect for
        // already-running sessions with exponential backoff.
        settle("closed");
        // Reconnect while a prompt is running OR during the post-settle grace
        // window so late extension events are not lost if the browser drops us.
        if (
          ctx.eventSourceRef.current === es
          && ctx.mountedRef.current
          && (ctx.agentRunningRef.current || ctx.eventStreamGraceActiveRef.current)
        ) {
          ctx.eventSourceRef.current = null;
          const attempt = ctx.sseReconnectAttemptRef.current + 1;
          ctx.sseReconnectAttemptRef.current = attempt;
          if (attempt > EVENT_STREAM_RECONNECT_MAX_ATTEMPTS) {
            // SSE is dead: do not invent a local idle flip (that also disabled
            // reconcile because agentRunning became false). Hand off to the
            // single settlement → finishPromptWithoutStream exit so server
            // idle still reloads messages; interval reconcile stays backup.
            ctx.eventStreamGraceActiveRef.current = false;
            const settleSid = ctx.sessionIdRef.current;
            if (settleSid && ctx.agentRunningRef.current) {
              void ctx.waitForPromptSettlementRef.current?.(settleSid, ctx.promptRunIdRef.current);
            }
            return;
          }
          const delayMs = Math.min(
            EVENT_STREAM_RECONNECT_BASE_MS * 2 ** (attempt - 1),
            EVENT_STREAM_RECONNECT_MAX_MS,
          );
          const reconnectGeneration = ctx.eventStreamGraceGenerationRef.current;
          ctx.sseReconnectTimerRef.current = setTimeout(() => {
            ctx.sseReconnectTimerRef.current = null;
            if (
              ctx.mountedRef.current
              && ctx.sessionIdRef.current === sid
              && !ctx.eventSourceRef.current
              && reconnectGeneration === ctx.eventStreamGraceGenerationRef.current
              && (ctx.agentRunningRef.current || ctx.eventStreamGraceActiveRef.current)
            ) {
              void connectEventSource(ctx, sid);
            }
          }, delayMs);
        }
      }
      // Recoverable errors (CONNECTING): let EventSource auto-reconnect.
      // The timeout above resolves only to let callers decide whether this
      // connection must be ready before they continue.
    };
  });
}

export async function ensureEventSourceConnected(
  ctx: AgentEventSourceContext,
  sid: string,
): Promise<void> {
  const result = await connectEventSource(ctx, sid);
  if (result.status === "connected" || result.source.readyState === EventSource.OPEN) return;
  if (ctx.eventSourceRef.current === result.source) ctx.eventSourceRef.current = null;
  result.source.close();
  throw new EventStreamConnectionError(result.status);
}
