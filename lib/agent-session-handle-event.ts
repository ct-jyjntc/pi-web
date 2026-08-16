/**
 * Dispatch one agent SSE event into session UI state.
 * Callers own run-id refs and the single finish/settle exits.
 */

import type { AgentMessage, ExtensionUiRequest, ToolResultMessage } from "@/lib/types";
import type { ContextUsage } from "@/lib/pi-types";
import { normalizeToolCalls } from "@/lib/normalize";
import { copyPresentationOntoToolCall, type ToolPresentation } from "@/lib/tool-presentation";
import { mergeDeliveredUserMessage } from "@/lib/agent-session-message-merge";
import {
  readCompactContextUsage,
  readCompactResult,
  type CompactResultInfo,
} from "@/lib/agent-session-compact-parse";
import {
  phaseWithToolEnd,
  phaseWithToolProgress,
  phaseWithToolStart,
  type AgentPhase,
} from "@/lib/agent-session-phase";
import { getToolExecutionProgress } from "@/lib/tool-execution-progress";
import type { QueuedMessages } from "@/lib/agent-session-live-apply";
import type { ClientAssistantMessageEvent } from "@/lib/agent-event-wire";
import type { StreamAction } from "@/lib/agent-session-stream-state";
import { EVENT_STREAM_RECONNECT_MAX_ATTEMPTS } from "@/lib/agent-run-lifecycle";
import {
  isWorkspaceMutatingTool,
  notifyWorkspaceFilesChanged,
} from "@/lib/workspace-change-notify";

/** Write/edit toolCallIds seen on start, so end can refresh explorer mid-turn. */
const pendingMutatingToolIds = new Set<string>();

export type AgentSessionEvent = {
  type: string;
  [key: string]: unknown;
};

export type AgentEventHandleContext = {
  agentRunningRef: { current: boolean };
  abortRequestedRef: { current: boolean };
  sessionIdRef: { current: string | null };
  promptRunIdRef: { current: number };
  streamAcceptRunIdRef: { current: number };
  optimisticUserMessageKeyRef: { current: string | null };
  sseReconnectAttemptRef: { current: number };
  sseReconnectTimerRef: { current: ReturnType<typeof setTimeout> | null };
  setAgentRunning: (v: boolean) => void;
  setAgentPhase: (v: AgentPhase | ((prev: AgentPhase) => AgentPhase)) => void;
  setRetryInfo: (v: { attempt: number; maxAttempts: number; errorMessage?: string } | null) => void;
  setMessages: (updater: (prev: AgentMessage[]) => AgentMessage[]) => void;
  setQueuedMessages: (v: QueuedMessages) => void;
  setIsCompacting: (v: boolean) => void;
  setCompactError: (v: string | null) => void;
  setCompactResult: (v: CompactResultInfo | null) => void;
  setContextUsage: (updater: (prev: ContextUsage | null) => ContextUsage | null) => void;
  dispatchStream: (action: StreamAction) => void;

  closeEvents: () => void;
  finishPromptWithoutStream: (sid: string | null, runId?: number) => Promise<void>;
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean) => Promise<unknown>;
  waitForPromptSettlement: (sid: string, runId?: number) => Promise<void>;
  handleExtensionUiRequest: (request: ExtensionUiRequest) => void;
  addNotice: (notice: { type?: "info" | "success" | "warning" | "error"; message: string }) => void;
  /** Only the two keys this dispatcher reads. */
  t: (key: "agent.commandFailed" | "agent.extensionFailed") => string;
};

export function handleAgentSessionEvent(
  event: AgentSessionEvent,
  ctx: AgentEventHandleContext,
): void {
  switch (event.type) {
    case "session_destroyed":
      pendingMutatingToolIds.clear();
      // Wrapper gone (idle/fork/delete). Stop reconnect thrash and finish the
      // local run if we still think it's active — do not leave a ghost stream.
      ctx.sseReconnectAttemptRef.current = EVENT_STREAM_RECONNECT_MAX_ATTEMPTS + 1;
      if (ctx.sseReconnectTimerRef.current) {
        clearTimeout(ctx.sseReconnectTimerRef.current);
        ctx.sseReconnectTimerRef.current = null;
      }
      // The server closes the stream right after this event. A server-side
      // close leaves EventSource in CONNECTING (not CLOSED), so it silently
      // auto-reconnects — and the events route recreates the whole agent
      // session for an unknown id, restarting its 10-minute idle timer. That
      // resurrection loop never ends, so close the stream explicitly here.
      ctx.closeEvents();
      if (ctx.agentRunningRef.current) {
        void ctx.finishPromptWithoutStream(ctx.sessionIdRef.current, ctx.promptRunIdRef.current);
      }
      break;
    case "agent_start": {
      // Accept streaming events for the current prompt generation. If this
      // start is from a remote/reconnect path without a local handleSend,
      // mint a run id so late events from a prior generation can be dropped.
      if (ctx.abortRequestedRef.current) break;
      if (!ctx.agentRunningRef.current) {
        ctx.promptRunIdRef.current += 1;
      }
      ctx.streamAcceptRunIdRef.current = ctx.promptRunIdRef.current;
      ctx.agentRunningRef.current = true;
      ctx.setAgentRunning(true);
      ctx.setAgentPhase({ kind: "waiting_model" });
      // Banner is only for the backoff wait. SDK auto_retry_end waits until
      // the retried assistant message finishes — hide as soon as this attempt
      // is in flight (continue() → agent_start).
      ctx.setRetryInfo(null);
      ctx.dispatchStream({ type: "start" });
      break;
    }
    case "agent_end": {
      // One logical prompt can emit multiple agent_end events before retrying,
      // compacting, or continuing messages queued by extension handlers.
      // Keep agentRunning true and SSE open until prompt_done + server-idle
      // settlement (or reconcile) so a mid-run end cannot drop the rest.
      if (!ctx.agentRunningRef.current) break;
      const runId = ctx.promptRunIdRef.current;
      // Only touch streaming UI if this still matches the generation that
      // accepted stream events. Late ends from a prior run are ignored.
      if (runId !== ctx.streamAcceptRunIdRef.current) break;
      ctx.setAgentPhase(null);
      ctx.setRetryInfo(null);
      ctx.dispatchStream({ type: "end" });
      const sid = ctx.sessionIdRef.current;
      if (sid) {
        // One reload with live state (queue / usage / widgets). Settlement
        // still owns the final idle flip — do not also GET /api/agent here.
        void ctx.loadSession(sid, false, true);
        // Kick settlement even if prompt_done is delayed/missing.
        void ctx.waitForPromptSettlement(sid, runId);
      }
      break;
    }
    case "prompt_done":
      if (!ctx.agentRunningRef.current) break;
      // Extension commands can call pi.sendUserMessage(), which starts its
      // agent run asynchronously. In that case prompt_done for the command
      // arrives before agent_start for the injected message. Give that run
      // time to start and settle against server state instead of ending the
      // UI immediately and dropping its subsequent streaming events.
      // Bind to the current run so a late prompt_done cannot finish a newer one.
      // Also the normal path for finishing after agent_end (multi-end runs).
      if (ctx.sessionIdRef.current) {
        void ctx.waitForPromptSettlement(ctx.sessionIdRef.current, ctx.promptRunIdRef.current);
      }
      break;
    case "prompt_error":
      ctx.addNotice({
        type: "error",
        message: (event.errorMessage as string | undefined) ?? ctx.t("agent.commandFailed"),
      });
      break;
    case "extension_error":
      ctx.addNotice({
        type: "error",
        message: (event.error as string | undefined) ?? ctx.t("agent.extensionFailed"),
      });
      break;
    case "connected":
      if (event.isStreaming === true && ctx.agentRunningRef.current) {
        ctx.setAgentPhase({ kind: "waiting_model" });
      } else {
        ctx.dispatchStream({ type: "end" });
      }
      break;
    case "message_start": {
      if (!ctx.agentRunningRef.current) break;
      if (ctx.promptRunIdRef.current !== ctx.streamAcceptRunIdRef.current) break;
      const startMsg = event.message as Partial<AgentMessage> | undefined;
      if (startMsg?.role === "assistant") {
        ctx.dispatchStream({ type: "snapshot", message: normalizeToolCalls(startMsg as AgentMessage) });
        ctx.setAgentPhase(null);
      }
      break;
    }
    case "message_update": {
      if (!ctx.agentRunningRef.current) break;
      if (ctx.promptRunIdRef.current !== ctx.streamAcceptRunIdRef.current) break;
      const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
      if (delta && typeof delta === "object") {
        ctx.dispatchStream({ type: "delta", event: delta });
        if (delta.type !== "toolcall_start" && delta.type !== "toolcall_delta") {
          ctx.setAgentPhase(null);
        }
      }
      break;
    }
    case "message_end": {
      // Same late-event guard: after reconcile finished this run,
      // loadSession already loaded this message from the session file —
      // appending it again would duplicate it.
      if (!ctx.agentRunningRef.current) break;
      if (ctx.promptRunIdRef.current !== ctx.streamAcceptRunIdRef.current) break;
      const completed = event.message as AgentMessage | undefined;
      if (completed && completed.role === "user") {
        // Delivered steering/follow-up messages surface here as user
        // messages. The run's initial prompt also emits one, but handleSend
        // already appended it optimistically. Consume only the still-adjacent
        // optimistic bubble; later same-text queue deliveries must render.
        const delivered = normalizeToolCalls(completed);
        const optimisticKey = ctx.optimisticUserMessageKeyRef.current;
        ctx.optimisticUserMessageKeyRef.current = null;
        ctx.setMessages((prev) => mergeDeliveredUserMessage(prev, delivered, optimisticKey));
      } else if (completed) {
        const presentation = (completed as { presentation?: ToolPresentation }).presentation;
        ctx.setMessages((prev) => {
          const withResult = [...prev, normalizeToolCalls(completed)];
          if (completed.role !== "toolResult" || !presentation) return withResult;
          const id = (completed as ToolResultMessage).toolCallId;
          return id ? copyPresentationOntoToolCall(withResult, id, presentation) : withResult;
        });
      }
      ctx.dispatchStream({ type: "end" });
      ctx.setAgentPhase({ kind: "waiting_model" });
      break;
    }
    case "tool_execution_start": {
      const id = event.toolCallId as string;
      const name = event.toolName as string;
      if (id && isWorkspaceMutatingTool(name)) pendingMutatingToolIds.add(id);
      ctx.setAgentPhase((prev) => phaseWithToolStart(prev, id, name));
      break;
    }
    case "tool_execution_update": {
      const id = event.toolCallId as string;
      const name = event.toolName as string;
      const progress = getToolExecutionProgress(event.partialResult);
      ctx.setAgentPhase((prev) => phaseWithToolProgress(prev, id, name, progress));
      break;
    }
    case "tool_execution_end": {
      const id = event.toolCallId as string;
      if (id && pendingMutatingToolIds.delete(id)) notifyWorkspaceFilesChanged();
      ctx.setAgentPhase((prev) => phaseWithToolEnd(prev, id));
      break;
    }
    case "queue_update":
      ctx.setQueuedMessages({
        steering: [...((event.steering as string[] | undefined) ?? [])],
        followUp: [...((event.followUp as string[] | undefined) ?? [])],
      });
      break;
    case "auto_retry_start":
      ctx.setRetryInfo({
        attempt: event.attempt as number,
        maxAttempts: event.maxAttempts as number,
        errorMessage: event.errorMessage as string | undefined,
      });
      break;
    case "auto_retry_end":
      ctx.setRetryInfo(null);
      break;
    case "compaction_start":
      if (ctx.abortRequestedRef.current) break;
      ctx.setIsCompacting(true);
      ctx.setCompactError(null);
      ctx.setCompactResult(null);
      break;
    case "compaction_end":
      ctx.setIsCompacting(false);
      if (event.errorMessage) {
        ctx.setCompactError(event.errorMessage as string);
        ctx.setCompactResult(null);
      } else if (!event.aborted) {
        ctx.setCompactResult(
          readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"),
        );
        // Refresh branch messages + live usage immediately (SDK leaves
        // getContextUsage null until the next assistant reply; server
        // estimates for the UI).
        const sid = ctx.sessionIdRef.current;
        if (sid) {
          void (async () => {
            await ctx.loadSession(sid, false, true);
            // Apply compact payload usage if state path was slow/missed.
            ctx.setContextUsage((prev) => readCompactContextUsage(event.result, prev?.contextWindow) ?? prev);
          })();
        }
      }
      break;
    case "extension_ui_request":
      if (ctx.abortRequestedRef.current && (event as ExtensionUiRequest).method !== "dismiss") break;
      ctx.handleExtensionUiRequest(event as ExtensionUiRequest);
      break;
  }
}
