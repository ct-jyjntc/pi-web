"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import type {
  AgentMessage,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionContext,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import { useLocale } from "@/hooks/useLocale";
import { getFullToolNames } from "@/lib/tool-presets";
import { ensureWebSettings } from "@/lib/web-settings-store";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import type { AttachedImage, ChatInputHandle } from "@/lib/chat-input-types";
import {
  AGENT_STATE_RECONCILE_MS,
  BASH_STATE_RECONCILE_MS,
  PROMPT_SETTLE_INITIAL_DELAY_MS,
  PROMPT_SETTLE_MAX_MS,
  PROMPT_SETTLE_POLL_MS,
} from "@/lib/agent-run-lifecycle";
import {
  applyLiveAgentStateFields,
  clampThinkingLevelForModel,
  normalizeQueuedMessages,
  queuedMessagesEqual,
  type AgentStateResponse,
  type QueuedMessages,
  type ThinkingLevelOption,
} from "@/lib/agent-session-live-apply";
import {
  createNoticeId,
  noticeReducer,
  NOTICE_EXIT_ANIMATION_MS,
  NOTICE_VISIBLE_MS,
  type NoticeType,
} from "@/lib/agent-session-notices";
import { userMessageKey } from "@/lib/agent-session-message-key";
import {
  readCompactContextUsage,
  readCompactResult,
  type CompactCommandResult,
  type CompactResultInfo,
} from "@/lib/agent-session-compact-parse";
import {
  EventStreamConnectionError,
  streamReducer,
} from "@/lib/agent-session-stream-state";
import type { AgentPhase } from "@/lib/agent-session-phase";
import { applyExtensionUiRequest } from "@/lib/agent-session-extension-ui";
import { parseSlashCommandLine } from "@/lib/agent-session-slash-parse";
import { handleAgentSessionEvent } from "@/lib/agent-session-handle-event";
import {
  cancelEventStreamGrace as cancelEventStreamGraceImpl,
  closeEventSource,
  connectEventSource,
  ensureEventSourceConnected,
  scheduleEventStreamClose as scheduleEventStreamCloseImpl,
  type AgentEventSourceContext,
} from "@/lib/agent-session-event-source";

// Re-export public types so existing `@/hooks/useAgentSession` importers stay stable.
export type { QueuedMessages, ThinkingLevelOption } from "@/lib/agent-session-live-apply";
export type { NoticeItem, NoticeType } from "@/lib/agent-session-notices";
export type { CompactResultInfo } from "@/lib/agent-session-compact-parse";
export type { AgentPhase } from "@/lib/agent-session-phase";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: SessionContext;
  /** File-based estimate for cold open (no live AgentSession yet). */
  contextUsage?: ContextUsage | null;
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface LastAssistantTextResponse {
  text?: string;
}

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string; supportsImage?: boolean };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  thinkingLevelPins?: Record<string, string>;
  modelScopeWarnings?: string[];
  imageSupport?: Record<string, boolean>;
  modelError?: string;
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
  } = opts;
  const { t } = useLocale();

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [bashRunning, setBashRunning] = useState(false);
  const [pendingBash, setPendingBash] = useState<{ command: string; excludeFromContext: boolean } | null>(null);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const thinkingLevelPinsRef = useRef<Record<string, string>>({});
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [modelImageSupport, setModelImageSupport] = useState<Record<string, boolean>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  // Apply default thinking level for brand-new sessions from web-settings.
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    void ensureWebSettings()
      .then((settings) => {
        const level = settings?.defaultThinkingLevel;
        if (cancelled || !level) return;
        const allowed: ThinkingLevelOption[] = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
        if (allowed.includes(level as ThinkingLevelOption)) {
          setThinkingLevel(level as ThinkingLevelOption);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isNew]);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });

  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const bashRunningRef = useRef(false);
  const bashRecoveryIdRef = useRef(0);
  /** Cancellation token for the prompt settlement poll loop (unmount / newer loop). */
  const promptSettleIdRef = useRef(0);
  /** Prompt run id currently owning a settlement loop, so it never runs twice. */
  const promptSettleRunIdRef = useRef<number | null>(null);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  /** Settlement kick from connectEvents (defined later) without a second finish path. */
  const waitForPromptSettlementRef = useRef<((sid: string, runId?: number) => Promise<void>) | null>(null);
  /** Monotonic id for the active prompt run; used to drop late SSE / loadSession results. */
  const promptRunIdRef = useRef(0);
  /** Epoch accepted for streaming message_* events (set on agent_start / local send). */
  const streamAcceptRunIdRef = useRef(0);
  const sseReconnectAttemptRef = useRef(0);
  const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Idle-grace window after UI settlement — keep SSE for late extension events. */
  const eventStreamGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamGraceGenerationRef = useRef(0);
  const eventStreamGraceActiveRef = useRef(false);
  const contextRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const executeBashRef = useRef<(command: string, excludeFromContext: boolean) => Promise<void> | undefined>(undefined);
  // Scroll follow is owned by use-stick-to-bottom (same approach as Hermes
  // desktop): it handles at-bottom detection, escape on upward intent, and
  // re-attach when scrolling back down. scrollContainerRef stays as our own
  // handle for the minimap and the page-up pagination restore.
  const {
    scrollRef: stickScrollRef,
    contentRef: chatContentRef,
    isAtBottom: stickToBottom,
    scrollToBottom: stickScrollToBottom,
    stopScroll,
  } = useStickToBottom({ initial: "instant", resize: "instant" });
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bindScrollContainer = useCallback(
    (el: HTMLDivElement | null) => {
      stickScrollRef(el);
      scrollContainerRef.current = el;
    },
    [stickScrollRef],
  );
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

  const sessionStats = useMemo(() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
      toolCalls += (msg as import("@/lib/types").AssistantMessage).content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  }, [messages, sessionStatsOverride, contextUsage, data?.filePath, session?.id, session?.name]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    let messagesLoaded = false;
    try {
      if (showLoading) setLoading(true);
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}?${params}`);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      if (sessionIdRef.current !== sid) return null;
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      if (d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }
      // Prefer file estimate immediately so cold open isn't stuck at 0%.
      // Live agent state (below) overwrites when the RPC session is running.
      if (d.contextUsage != null) setContextUsage(d.contextUsage);
      else setContextUsage(null);

      messagesLoaded = true;
      if (showLoading) setLoading(false);
      if (!includeState) return null;

      try {
        // Same live snapshot as settlement/reconcile — one endpoint for all readers.
        const stateRes = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
        const agentState = await stateRes.json() as { running: boolean; state?: AgentStateResponse };
        if (sessionIdRef.current !== sid) return null;

        const liveState = agentState.state;
        if (liveState) {
          applyLiveAgentStateFields(liveState, {
            setContextUsage,
            setSystemPrompt,
            setThinkingLevel,
            setExtensionStatuses,
            setExtensionWidgets,
            setQueuedMessages,
          });
        } else if (!agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
          // Keep file-based contextUsage when no live session is running.
        }
        return agentState;
      } catch (e) {
        console.error("Failed to load agent state:", e);
        return null;
      }
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading && !messagesLoaded) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    const requestId = ++contextRequestIdRef.current;
    try {
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      if (leafId) params.set("leafId", leafId);
      const url = `/api/sessions/${encodeURIComponent(sid)}/context?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as {
        context: { messages: AgentMessage[]; entryIds: string[] };
        contextUsage?: ContextUsage | null;
      };
      // Drop stale responses from rapid branch switching.
      if (requestId !== contextRequestIdRef.current) return;
      if (sessionIdRef.current !== sid) return;
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      if (d.contextUsage) setContextUsage(d.contextUsage);
    } catch (e) {
      if (requestId === contextRequestIdRef.current) {
        console.error("Failed to load context:", e);
      }
    }
  }, []);

  const loadTools = useCallback(async (sid: string) => {
    try {
      // Force full built-in tool set for every session (no user tool preset UI).
      await sendAgentCommand(sid, { type: "set_tools", toolNames: getFullToolNames() });
    } catch (e) {
      console.error("Failed to load/set tools:", e);
    }
  }, []);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      name: undefined,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
    });
  }, [isNew, newSessionCwd, onSessionCreated]);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const selectedModel = newSessionModel ?? newSessionDefaultModel;
      if (selectedModel) setPendingModel(selectedModel);
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          toolNames: getFullToolNames(),
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { sessionId: string };
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, newSessionModel, newSessionDefaultModel, thinkingLevel]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  const getEventSourceCtx = useCallback((): AgentEventSourceContext => ({
    eventSourceRef,
    sessionIdRef,
    agentRunningRef,
    mountedRef,
    promptRunIdRef,
    sseReconnectAttemptRef,
    sseReconnectTimerRef,
    eventStreamGraceTimerRef,
    eventStreamGraceGenerationRef,
    eventStreamGraceActiveRef,
    waitForPromptSettlementRef,
    handleAgentEventRef,
    setAgentRunning,
    setAgentPhase,
    setIsCompacting,
  }), []);

  const cancelEventStreamGrace = useCallback(() => {
    cancelEventStreamGraceImpl(getEventSourceCtx());
  }, [getEventSourceCtx]);

  const closeEvents = useCallback(() => {
    closeEventSource(getEventSourceCtx());
  }, [getEventSourceCtx]);

  const scheduleEventStreamClose = useCallback((sid: string) => {
    scheduleEventStreamCloseImpl(getEventSourceCtx(), sid);
  }, [getEventSourceCtx]);

  const ensureEventsConnected = useCallback(async (sid: string) => {
    await ensureEventSourceConnected(getEventSourceCtx(), sid);
  }, [getEventSourceCtx]);

  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => {
    const sid = sessionIdRef.current;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
    }
  }, []);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, []);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type: notice.type ?? "info",
      },
    });
  }, []);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    applyExtensionUiRequest(request, {
      setExtensionDialog,
      setExtensionCustomUi,
      setExtensionStatuses,
      setExtensionWidgets,
      addNotice,
      insertEditorText: (text) => opts.chatInputRef?.current?.insertText(text),
    });
  }, [addNotice, opts.chatInputRef]);

  const finishPromptWithoutStream = useCallback(async (sid: string | null = sessionIdRef.current, runId?: number) => {
    // Bail out before loadSession too: a stale finish for a previous run
    // must not overwrite the messages of the run currently streaming.
    if (runId !== undefined && promptRunIdRef.current !== runId) return;
    try {
      if (sid) await loadSession(sid);
    } finally {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      const wasRunning = agentRunningRef.current;
      agentRunningRef.current = false;
      // Keep SSE open for a short grace window so late extension events
      // (status widgets, follow-up agent_start) are not dropped. Hard-close
      // only when there is no session id to grace-check against.
      if (sid) scheduleEventStreamClose(sid);
      else closeEvents();
      optimisticUserMessageKeyRef.current = null;
      if (!wasRunning) return;
      setAgentRunning(false);
      setAgentPhase(null);
      setRetryInfo(null);
      dispatch({ type: "end" });
      onAgentEnd?.();
    }
  }, [closeEvents, loadSession, onAgentEnd, scheduleEventStreamClose]);

  const waitForPromptSettlement = useCallback(async (sid: string, runId?: number) => {
    // One settlement loop per run: a slash command starts one from handleSend and
    // its prompt_done starts another for the same run. Two loops only double the
    // /api/agent/[id] polling rate (each request re-estimates context tokens over
    // the whole message list) while SSE is already streaming normally.
    const runKey = runId ?? promptRunIdRef.current;
    if (promptSettleRunIdRef.current === runKey) return;
    promptSettleRunIdRef.current = runKey;
    // Cancellation token, same shape as bashRecoveryIdRef: bumped by a newer loop
    // and by unmount cleanup so a stale hook cannot keep polling for 20s after a
    // session switch (and cannot call finishPromptWithoutStream → loadSession).
    const settleId = promptSettleIdRef.current + 1;
    promptSettleIdRef.current = settleId;

    try {
      await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
      const startedAt = Date.now();

      while (
        agentRunningRef.current
        && mountedRef.current
        && promptSettleIdRef.current === settleId
        && sessionIdRef.current === sid
        && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS
      ) {
        if (runId !== undefined && promptRunIdRef.current !== runId) return;
        try {
          const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
          if (res.ok) {
            const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
            const state = data.state;
            if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
              // The fetch above straddles the cancellation checks, so re-verify
              // before the expensive finish path (loadSession + full reconcile).
              if (!mountedRef.current || promptSettleIdRef.current !== settleId) return;
              await finishPromptWithoutStream(sid, runId);
              return;
            }
          }
        } catch {
          // SSE remains the primary completion path.
        }
        await delay(PROMPT_SETTLE_POLL_MS);
      }
    } finally {
      // Release the per-run slot only if no newer loop took over, so a second
      // prompt_done for the same run (extension-injected prompts) can still get
      // a fresh safety net once this one is done.
      if (promptSettleIdRef.current === settleId && promptSettleRunIdRef.current === runKey) {
        promptSettleRunIdRef.current = null;
      }
    }
  }, [finishPromptWithoutStream]);

  waitForPromptSettlementRef.current = waitForPromptSettlement;

  const waitForBashSettlement = useCallback(async (sid: string) => {
    const recoveryId = bashRecoveryIdRef.current + 1;
    bashRecoveryIdRef.current = recoveryId;

    while (
      bashRunningRef.current
      && bashRecoveryIdRef.current === recoveryId
      && sessionIdRef.current === sid
    ) {
      await delay(BASH_STATE_RECONCILE_MS);
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!res.ok) continue;
        const data = await res.json() as { state?: AgentStateResponse };
        if (data.state?.isBashRunning) continue;

        await loadSession(sid);
        if (bashRecoveryIdRef.current !== recoveryId || sessionIdRef.current !== sid) return;
        bashRunningRef.current = false;
        setBashRunning(false);
        setPendingBash(null);
        return;
      } catch {
        // Keep polling while the page is mounted; network recovery is transparent.
      }
    }
  }, [loadSession]);

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_end never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same path as prompt_done.
  const reconcileAgentState = useCallback(async (sid: string) => {
    if (!agentRunningRef.current) return;
    const runId = promptRunIdRef.current;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      // A slow response can straddle a run boundary (previous run finished
      // and the user already started the next one while this request was in
      // flight) — everything in it is stale, drop it.
      if (promptRunIdRef.current !== runId) return;
      const state = data.state;
      // Mirror compaction state unconditionally: a missed compaction_end
      // would otherwise leave the "Stop compaction" UI stuck. No state
      // (wrapper destroyed) means nothing is compacting.
      setIsCompacting(state?.isCompacting ?? false);
      // Reconciliation runs every 15s while the agent is busy; a fresh object
      // would re-render the whole chat (and remount ChatInput's composer
      // observer) even though the queue is almost always unchanged.
      const nextQueued = normalizeQueuedMessages(state?.queuedMessages);
      setQueuedMessages((prev) => queuedMessagesEqual(prev, nextQueued) ? prev : nextQueued);
      const busy = data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isCompacting);
      if (busy || !agentRunningRef.current) return;
      applyLiveAgentStateFields(state, {
        setContextUsage,
        setSystemPrompt,
        setExtensionStatuses,
        setExtensionWidgets,
      });
      await finishPromptWithoutStream(sid, runId);
    } catch {
      // Network still down — the next poll / visibility / online tick retries.
    }
  }, [finishPromptWithoutStream]);

  // Recovery net for missed SSE when settlement is not already polling:
  // tab foreground / network restore, plus a slow interval as last resort.
  // Settlement owns the happy-path idle flip — skip while it is active.
  useEffect(() => {
    if (!agentRunning) return;
    const reconcile = () => {
      if (promptSettleRunIdRef.current !== null) return;
      // Read the ref on every tick: for brand-new sessions the id is
      // assigned only after ensure_session returns.
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = setInterval(reconcile, AGENT_STATE_RECONCILE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, reconcileAgentState]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  // Coalesce high-frequency streaming updates: dispatch at most once per
  // 80ms window (leading + trailing) so each SSE token doesn't re-render
  // the whole chat tree.
  const pendingStreamUpdateRef = useRef<Partial<AgentMessage> | null>(null);
  const streamUpdateTimerRef = useRef<number | null>(null);
  const clearPendingStreamUpdate = useCallback(() => {
    pendingStreamUpdateRef.current = null;
    if (streamUpdateTimerRef.current !== null) {
      window.clearTimeout(streamUpdateTimerRef.current);
      streamUpdateTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearPendingStreamUpdate, [clearPendingStreamUpdate]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    handleAgentSessionEvent(event, {
      agentRunningRef,
      sessionIdRef,
      promptRunIdRef,
      streamAcceptRunIdRef,
      optimisticUserMessageKeyRef,
      sseReconnectAttemptRef,
      sseReconnectTimerRef,
      pendingStreamUpdateRef,
      streamUpdateTimerRef,
      setAgentRunning,
      setAgentPhase,
      setRetryInfo,
      setMessages,
      setQueuedMessages,
      setIsCompacting,
      setCompactError,
      setCompactResult,
      setContextUsage,
      dispatchStream: dispatch,
      clearPendingStreamUpdate,
      closeEvents,
      finishPromptWithoutStream,
      loadSession,
      waitForPromptSettlement,
      handleExtensionUiRequest,
      addNotice,
      t,
    });
  }, [addNotice, clearPendingStreamUpdate, closeEvents, finishPromptWithoutStream, handleExtensionUiRequest, loadSession, waitForPromptSettlement, t]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return;
    if (agentRunningRef.current || bashRunningRef.current) return;
    const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");

    const isBashCommand = !images?.length && trimmedMessage.startsWith("!");
    if (isBashCommand) {
      const isExcluded = trimmedMessage.startsWith("!!");
      const bashCmd = (isExcluded ? trimmedMessage.slice(2) : trimmedMessage.slice(1)).trim();
      if (!bashCmd) return;
      await executeBashRef.current?.(bashCmd, isExcluded);
      return;
    }

    const promptRunId = promptRunIdRef.current + 1;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
    promptRunIdRef.current = promptRunId;
    // Accept stream events for this generation immediately (before agent_start),
    // so early tokens are not dropped; late events from prior runs still mismatch.
    streamAcceptRunIdRef.current = promptRunId;
    sseReconnectAttemptRef.current = 0;
    cancelEventStreamGrace();
    agentRunningRef.current = true;
    setAgentRunning(true);
    setAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
    dispatch({ type: "start" });
    // Match Hermes desktop's runStart behavior: re-engage follow mode so the
    // growing model reply stays pinned into view.
    void stickScrollToBottom();

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    let sentSessionId: string | null = null;
    let promptRequestStarted = false;

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        const existingSid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
        const sid = existingSid ?? await ensureNewSession();

        if (sid) {
          sentSessionId = sid;
          if (selectedModel) {
            setPendingModel(selectedModel);
            if (existingSid) {
              await sendAgentCommand(sid, { type: "set_model", provider: selectedModel.provider, modelId: selectedModel.modelId });
            }
          }
          await ensureEventsConnected(sid);
          promptRequestStarted = true;
          await sendAgentCommand(sid, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
          promoteNewSession(1, message);
        }
      } else if (session) {
        sentSessionId = session.id;
        await ensureEventsConnected(session.id);
        promptRequestStarted = true;
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
      // Slash commands and normal prompts both settle via prompt_done / idle poll;
      // slash starts early because some commands never stream agent_end reliably.
      if (isSlashCommandPrompt && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      // A failed prompt POST is ambiguous once SSE was opened: the server may
      // have accepted the run before the response was lost. Keep the stream
      // alive until idle settlement so a real run cannot continue unseen.
      if (promptRequestStarted && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
        return;
      }
      // True pre-flight failure (never reached the agent): roll back optimistic UI.
      const optimisticKey = optimisticUserMessageKeyRef.current;
      if (optimisticKey) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return last?.role === "user" && userMessageKey(last) === optimisticKey
            ? prev.slice(0, -1)
            : prev;
        });
      }
      addNotice({
        type: "error",
        message: e instanceof EventStreamConnectionError && (e.message === "agent.sseTimeout" || e.message === "agent.sseFailed")
          ? t(e.message)
          : e instanceof Error ? e.message : String(e),
      });
      if (message) opts.chatInputRef?.current?.insertIfEmpty(message);
      optimisticUserMessageKeyRef.current = null;
      agentRunningRef.current = false;
      closeEvents();
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, session, ensureNewSession, ensureEventsConnected, promoteNewSession, waitForPromptSettlement, addNotice, cancelEventStreamGrace, closeEvents, stickScrollToBottom, opts.chatInputRef, t]);

  const executeBash = useCallback(async (command: string, excludeFromContext: boolean) => {
    if (agentRunningRef.current || bashRunningRef.current) return;
    const inputText = `${excludeFromContext ? "!!" : "!"}${command}`;
    bashRunningRef.current = true;
    setPendingBash({ command, excludeFromContext });
    setBashRunning(true);
    try {
      const sid = sessionIdRef.current ?? session?.id ?? await ensureNewSession();
      if (!sid) throw new Error("Unable to create a session for the shell command");
      await sendAgentCommand(sid, {
        type: "bash",
        command,
        excludeFromContext,
      });
      await loadSession(sid);
      promoteNewSession(1, inputText);
    } catch (e) {
      console.error("Failed to execute shell command:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      opts.chatInputRef?.current?.insertIfEmpty(inputText);
    } finally {
      bashRunningRef.current = false;
      setPendingBash(null);
      setBashRunning(false);
    }
  }, [addNotice, ensureNewSession, loadSession, opts.chatInputRef, promoteNewSession, session]);
  executeBashRef.current = executeBash;

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    if (bashRunningRef.current) {
      try {
        await sendAgentCommand(sid, { type: "abort_bash" });
      } catch (e) {
        console.error("Failed to abort bash:", e);
      }
      return;
    }
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    if (bashRunningRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
      addNotice({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setForkingEntryId(null);
    }
  }, [addNotice, onSessionForked]);

  const navigateToLeaf = useCallback(async (leafId: string | null) => {
    if (bashRunningRef.current || agentRunningRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    if (leafId) {
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean }>(sid, {
          type: "navigate_tree",
          targetId: leafId,
        });
        if (result?.cancelled) {
          addNotice({ type: "error", message: t("agent.commandFailed") });
          return;
        }
      } catch (e) {
        console.error("Navigate failed:", e);
        addNotice({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    }
    setActiveLeafId(leafId);
    await loadContext(sid, leafId);
  }, [addNotice, loadContext, t]);

  const handleNavigate = useCallback(async (entryId: string) => {
    await navigateToLeaf(entryId);
  }, [navigateToLeaf]);

  const handleLeafChange = navigateToLeaf;

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    const key = `${provider}:${modelId}`;
    const supported = modelThinkingLevels[key];
    const nextThinking = clampThinkingLevelForModel(thinkingLevel, supported);
    if (nextThinking !== thinkingLevel) {
      setThinkingLevel(nextThinking);
    }

    if (isNew) {
      setNewSessionModel({ provider, modelId });
      setPendingModel({ provider, modelId });
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        if (nextThinking !== "auto") {
          await sendAgentCommand(sid, { type: "set_thinking_level", level: nextThinking });
        }
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
      if (nextThinking !== "auto") {
        await sendAgentCommand(sid, { type: "set_thinking_level", level: nextThinking });
      }
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew, modelThinkingLevels, setNewSessionModel, thinkingLevel]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      // includeState: pull post-compaction estimated usage into the ring/panel
      await loadSession(sid, true, true);
      setContextUsage((prev) => readCompactContextUsage(result, prev?.contextWindow) ?? prev);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    const res = await fetch(modelsUrl, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as ModelsResponse;
    setModelNames(d.models);
    setModelError(d.modelError ?? null);
    setModelScopeWarnings(d.modelScopeWarnings ?? []);
    thinkingLevelPinsRef.current = d.thinkingLevelPins ?? {};
    setModelThinkingLevels(d.thinkingLevels ?? {});
    setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
    setModelImageSupport(d.imageSupport ?? {});
    const nextModelList = d.modelList ?? [];
    setModelList(nextModelList);
    if (isNew) {
      const match = d.defaultModel
        ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
        : undefined;
      const displayModel = match ?? nextModelList[0];
      setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
      // Apply `:thinkingLevel` pin from enabledModels for the pre-selected model.
      if (displayModel && thinkingLevel === "auto") {
        const pin = thinkingLevelPinsRef.current[`${displayModel.provider}/${displayModel.id}`];
        if (pin === "off" || pin === "minimal" || pin === "low" || pin === "medium" || pin === "high" || pin === "xhigh" || pin === "max") {
          setThinkingLevel(pin);
        }
      }
    }
  }, [isNew, newSessionCwd, session?.cwd, thinkingLevel]);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    const parsed = parseSlashCommandLine(text);
    if (!parsed) return { handled: false };

    const { name: commandName, args } = parsed;
    const sid = sessionIdRef.current ?? await ensureNewSession();
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (result.action !== "openSessionStats") {
        addNotice({ type: "success", message: result.message ?? t("agent.commandCompleted") });
      }
      return result;
    };

    try {
      switch (commandName) {
        case "compact": {
          if (!sid || isCompacting) return complete({ handled: true, error: t("agent.noSessionCompact") });
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<CompactCommandResult>(sid, {
            type: "compact",
            ...(args ? { customInstructions: args } : {}),
          });
          setCompactResult(readCompactResult(result, "manual"));
          if (await loadSession(sid, true, true)) promoteNewSession();
          setContextUsage((prev) => readCompactContextUsage(result, prev?.contextWindow) ?? prev);
          return complete({ handled: true, message: t("agent.compacted") });
        }

        case "reload": {
          if (!sid) return complete({ handled: true, error: t("agent.noSessionReload") });
          await sendAgentCommand(sid, { type: "reload" });
          await Promise.all([
            loadSession(sid, false, true),
            loadTools(sid),
            loadSlashCommands(),
            loadModels(),
          ]);
          return complete({ handled: true, message: t("agent.reloaded") });
        }

        case "name": {
          if (!sid) return complete({ handled: true, error: t("agent.noSessionName") });
          if (!args) return complete({ handled: true, error: t("agent.nameUsage") });
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          if (await loadSession(sid)) promoteNewSession();
          return complete({ handled: true, message: t("agent.renamed", { name: args }) });
        }

        case "session": {
          if (!sid) return complete({ handled: true, error: t("agent.noSession") });
          const stats = await sendAgentCommand<SessionStatsInfo>(sid, { type: "get_session_stats" });
          if (stats) {
            setSessionStatsOverride(stats);
          }
          onSessionStatsPanelOpen?.();
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "copy": {
          if (!sid) return complete({ handled: true, error: t("agent.noSession") });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: t("agent.noAssistantCopy") });
          await navigator.clipboard.writeText(textToCopy);
          return complete({ handled: true, message: t("agent.copiedAssistant") });
        }

        default:
          return { handled: false };
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (commandName === "compact") setIsCompacting(false);
    }
  }, [addNotice, ensureNewSession, isCompacting, loadModels, loadSession, loadSlashCommands, loadTools, promoteNewSession, onSessionStatsPanelOpen, t]);

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      if (message) opts.chatInputRef?.current?.insertIfEmpty(message);
    }
  }, [addNotice, opts.chatInputRef]);

  const handlePromptWithStreamingBehavior = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "prompt",
        message,
        streamingBehavior: behavior,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to queue prompt:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      if (message) opts.chatInputRef?.current?.insertIfEmpty(message);
    }
  }, [addNotice, opts.chatInputRef]);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      if (message) opts.chatInputRef?.current?.insertIfEmpty(message);
    }
  }, [addNotice, opts.chatInputRef]);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: t("agent.recallQueueFailed") });
    }
  }, [opts.chatInputRef, addNotice, t]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const resumeStickToBottom = useCallback(() => {
    void stickScrollToBottom();
  }, [stickScrollToBottom]);

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then((agentState) => {
        if (agentState?.running) {
          loadTools(session.id);
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(agentState.state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
            dispatch({ type: "start" });
            void connectEventSource(getEventSourceCtx(), session.id);
            if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
              // Bind settlement to a run id so it cannot finish a later user send.
              const runId = promptRunIdRef.current + 1;
              promptRunIdRef.current = runId;
              streamAcceptRunIdRef.current = runId;
              void waitForPromptSettlement(session.id, runId);
            }
          }
          if (agentState.state?.isBashRunning) {
            bashRunningRef.current = true;
            setBashRunning(true);
            void waitForBashSettlement(session.id);
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          applyLiveAgentStateFields(agentState.state, {
            setContextUsage,
            setSystemPrompt,
            setThinkingLevel,
            setExtensionStatuses,
            setExtensionWidgets,
            setQueuedMessages,
          });
        }
      });
    }
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      bashRecoveryIdRef.current += 1;
      promptSettleIdRef.current += 1;
      promptSettleRunIdRef.current = null;
      eventStreamGraceGenerationRef.current += 1;
      eventStreamGraceActiveRef.current = false;
      if (eventStreamGraceTimerRef.current) {
        clearTimeout(eventStreamGraceTimerRef.current);
        eventStreamGraceTimerRef.current = null;
      }
      if (sseReconnectTimerRef.current) {
        clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  // Keep compact result toast brief; leave compactError sticky until the next
  // compact attempt so provider/compaction failures stay visible.
  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => {
        dispatchNotice({ type: "remove", id: exiting.id });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldest = noticeState.visible[0];
    if (!oldest) return;
    const t = setTimeout(() => {
      dispatchNotice({ type: "mark_oldest_exiting" });
    }, NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [messages.length, contextUsage?.tokens, contextUsage?.percent, contextUsage?.contextWindow]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, modelImageSupport, newSessionModel, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices: noticeState.visible, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase,
    isNew,
    // Refs
    sessionIdRef, eventSourceRef, scrollContainerRef,
    // Scroll follow (use-stick-to-bottom)
    stickToBottom, resumeStickToBottom, bindScrollContainer, chatContentRef, stopScroll, stickScrollToBottom,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleThinkingLevelChange, loadTools, loadSlashCommands, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId, addNotice,
    bashRunning, pendingBash,
    // Subscriptions
    handleAgentEventRef,
  };
}
