"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import Image from "next/image";
import { Fragment, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AgentMessage, AssistantMessage, BashExecutionMessage, ToolResultMessage } from "@/lib/types";
import { isMemoryContextMessage } from "@/lib/message-display";
import { ArrowDown } from "lucide-react";
import { MessageView } from "./MessageView";
import { ChatInput } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { Icon } from "./Icon";
import { useAgentSession, type UseAgentSessionOptions } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/hooks/useLocale";
import {
  captureScrollDistance,
  getNextVisibleCount,
  getVisibleRenderWindow,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
import { classifyWidgetKey, isChromeTopBarWidgetKey, todoWidgetHasContent } from "@/lib/extension-widgets";
import { clearSessionMetrics, setChromeWidgetsMetric, setContextUsageMetric, setExtensionStatusesMetric, setSessionStatsMetric } from "@/lib/session-metrics-store";
import { deriveTodoWidgetLines } from "@/lib/todo-from-transcript";
import { setCompactHandlers } from "@/lib/compact-action-store";
import { setSessionNavHandlers } from "@/lib/session-nav-store";
import { useWebSettings } from "@/lib/web-settings-store";
import {
  CHAT_COLUMN_PADDING,
  CHAT_RAIL_BTN_WIDTH,
  CHAT_RAIL_WIDTH,
  FIRST_PAINT_RENDER_ITEMS,
  LIVE_TAIL_RENDER_ITEMS,
  SCROLL_SETTLE_MAX_FRAMES,
  SCROLL_SETTLE_STABLE_FRAMES,
  findFinalAssistantIndex,
  getFinalAssistantParts,
  getTurnToolCallCount,
  getUserInputText,
  hasDisplayableProcessMessage,
  phaseLabel,
  type RenderPlanItem,
} from "./chat-window/chat-window-helpers";
import { ProcessDetailsGroup } from "./chat-window/ProcessDetailsGroup";
import { ExtensionWidgets } from "./chat-window/ExtensionWidgets";
import { NoticeShelf } from "./chat-window/NoticeShelf";
import {
  ExtensionCustomPanel,
  ExtensionDialog,
} from "./chat-window/ExtensionPanels";

type Props = Pick<
  UseAgentSessionOptions,
  | "session"
  | "newSessionCwd"
  | "onAgentEnd"
  | "onSessionCreated"
  | "onSessionForked"
  | "modelsRefreshKey"
  | "chatInputRef"
  | "onBranchDataChange"
  | "onSystemPromptChange"
  | "onSessionStatsPanelOpen"
> & {
  onOpenFile?: (filePath: string) => void;
};

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen, onOpenFile }: Props) {
  const { t, locale } = useLocale();
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerUnderlayRef = useRef<HTMLDivElement>(null);
  const composerToolbarRef = useRef<HTMLDivElement | null>(null);
  const [composerDockH, setComposerDockH] = useState(128);


  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  // Live web-settings subscription: toggles apply to the open chat immediately.
  // (The old mount/visibilitychange fetch left showTodos stale until a tab switch.)
  const webSettings = useWebSettings();
  const notifyPrefsRef = useRef({ desktop: true, notifSound: true });
  notifyPrefsRef.current = {
    desktop: webSettings?.desktopNotifications !== false,
    notifSound: webSettings?.notificationSound !== false,
  };
  const showTodos = webSettings?.showTodos !== false;
  const [advisorNote, setAdvisorNote] = useState<{
    level: "info" | "concern" | "blocker";
    text: string;
    model: string;
  } | null>(null);
  const advisorEnabledRef = useRef(false);
  advisorEnabledRef.current = webSettings?.advisorEnabled === true;
  // Session id readable from callbacks declared before useAgentSession below
  // (synced right after the hook destructure, like messagesForAdvisorRef).
  const sessionIdForReviewRef = useRef<string | null>(null);
  const messagesForAdvisorRef = useRef<AgentMessage[]>([]);
  const wrappedOnAgentEnd = useCallback(() => {
    // In-app completion tone (composer sound toggle).
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    // System / desktop notification (separate preference).
    if (notifyPrefsRef.current.desktop && typeof window !== "undefined") {
      const body = t("notify.taskComplete");
      const silent = !notifyPrefsRef.current.notifSound;
      const desktop = window.piDesktop as
        | { isDesktop?: boolean; notify?: (p: { title: string; body: string; silent?: boolean }) => Promise<unknown> }
        | undefined;
      if (desktop?.isDesktop && typeof desktop.notify === "function") {
        void desktop.notify({ title: "Pi Web", body, silent });
      } else if (typeof Notification !== "undefined") {
        const show = () => {
          try {
            new Notification("Pi Web", { body, silent });
          } catch {
            // ignore
          }
        };
        if (Notification.permission === "granted") show();
        else if (Notification.permission === "default") {
          void Notification.requestPermission().then((p) => {
            if (p === "granted") show();
          });
        }
      }
    }

    // Optional advisor review of the latest turn.
    if (advisorEnabledRef.current) {
      const msgs = messagesForAdvisorRef.current;
      let userText = "";
      let assistantText = "";
      const tools: string[] = [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m) continue;
        if (!assistantText && m.role === "assistant") {
          const content = (m as AssistantMessage).content ?? [];
          assistantText = content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          for (const b of content) {
            if (b.type === "toolCall") tools.push(b.toolName || "tool");
          }
        } else if (assistantText && m.role === "user") {
          const c = m.content;
          userText = typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text").map((b) => b.text).join("\n")
              : "";
          break;
        }
      }
      const cwd = session?.cwd ?? newSessionCwd;
      if (cwd && (userText || assistantText)) {
        void fetch("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd,
            userText,
            assistantText,
            toolSummary: tools.join(", "),
          }),
        })
          .then(async (res) => {
            const data = await res.json() as {
              note?: { level: "info" | "concern" | "blocker"; text: string; model: string } | null;
            };
            if (data.note) setAdvisorNote(data.note);
          })
          .catch(() => {});
      }
    }

    // Background memory review — fire-and-forget; the server-side cadence
    // counter decides whether this turn actually triggers a review.
    const memoryCwd = session?.cwd ?? newSessionCwd;
    const memorySessionId = session?.id ?? sessionIdForReviewRef.current;
    if (memoryCwd && memorySessionId) {
      void fetch("/api/memory-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: memoryCwd, sessionId: memorySessionId }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json() as { saved?: Array<{ scope: string; text: string }> };
          const count = data.saved?.length ?? 0;
          if (count > 0) {
            addNoticeRef.current({ type: "info", message: t("memory.savedNotice", { count }) });
          }
        })
        .catch(() => {});
    }
    onAgentEnd?.();
  }, [newSessionCwd, onAgentEnd, session?.cwd, session?.id, t]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, modelImageSupport, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    addNotice,
    isAutoModelSelection,
    agentPhase,
    isNew,
    sessionIdRef, scrollContainerRef,
    stickToBottom, resumeStickToBottom, bindScrollContainer, chatContentRef, stopScroll, stickScrollToBottom,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleThinkingLevelChange, loadSlashCommands,
    sessionMode, setAgentMode,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd: wrappedOnAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
  });
  const sessionBusy = agentRunning || bashRunning;
  // Stable handle for fire-and-forget callbacks created before the hook
  // destructure above (wrappedOnAgentEnd) — they read this at call time.
  const addNoticeRef = useRef(addNotice);
  addNoticeRef.current = addNotice;
  sessionIdForReviewRef.current = session?.id ?? sessionIdRef.current ?? null;
  useEffect(() => {
    messagesForAdvisorRef.current = messages;
  }, [messages]);


  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  // First paint mounts a small window (FIRST_PAINT_RENDER_ITEMS — roughly a
  // viewport's worth after scroll-to-bottom); the backfill below bumps it to
  // the full first page on the next frame as a transition, so the heavy
  // markdown/highlight render of older items is interruptible instead of one
  // long synchronous commit right after a session switch.
  const [visibleCount, setVisibleCount] = useState(FIRST_PAINT_RENDER_ITEMS);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);
  const hasMessages = messages.length > 0;

  // Backfill from the first-paint window to the normal initial page once
  // messages arrive (mount is empty; the transcript lands async). Functional
  // max: a user-initiated sentinel page can land first and must not be shrunk.
  useEffect(() => {
    if (!hasMessages || visibleCount >= VISIBLE_PAGE_SIZE) return;
    const rafId = requestAnimationFrame(() => {
      startTransition(() => {
        setVisibleCount((count) => Math.max(count, VISIBLE_PAGE_SIZE));
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [hasMessages, visibleCount]);

  // --- Scroll settle loop (cold-load glue) ---
  // Messages arrive hundreds of ms after mount, and late async work (KaTeX,
  // mermaid, image sizing) keeps changing scrollHeight after first paint.
  // Letting use-stick-to-bottom follow a moving target re-pins every frame
  // (visible as repeated scroll jumps), so instead: quiet the library, glue
  // scrollTop to the true bottom each rAF until the height holds steady for
  // SCROLL_SETTLE_STABLE_FRAMES consecutive frames (capped), then hand back
  // with an instant scrollToBottom so follow re-locks. Re-arms on the
  // empty→non-empty flip, which is exactly the cold-load moment; session
  // switches are full remounts.
  useLayoutEffect(() => {
    if (!hasMessages) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    stopScroll();
    el.scrollTop = el.scrollHeight;
    let frame = 0;
    let stableFrames = 0;
    let lastHeight = el.scrollHeight;
    let lastGluedBottom = lastHeight;
    let rafId = 0;
    const settle = () => {
      const node = scrollContainerRef.current;
      if (!node) return;
      // Abort if the user scrolled up during the settle window: transcript
      // content only grows at the bottom, so an untouched scrollTop can never
      // sit above where the last glue left it — if it does, it is user intent
      // and the library has already escaped the lock on its own.
      if (node.scrollTop < lastGluedBottom - node.clientHeight - 1) return;
      const height = node.scrollHeight;
      stableFrames = height === lastHeight ? stableFrames + 1 : 0;
      lastHeight = height;
      node.scrollTop = height;
      lastGluedBottom = height;
      if (stableFrames >= SCROLL_SETTLE_STABLE_FRAMES || ++frame > SCROLL_SETTLE_MAX_FRAMES) {
        void stickScrollToBottom("instant");
        return;
      }
      rafId = requestAnimationFrame(settle);
    };
    rafId = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(rafId);
  }, [hasMessages, stopScroll, stickScrollToBottom, scrollContainerRef]);

  // IntersectionObserver on the sentinel div at the top of the message list.
  // When it becomes visible, load the next page of older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          // Save distance from top before prepending to restore scroll later
          prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
          setVisibleCount((prev) => getNextVisibleCount(prev));
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, messages.length, scrollContainerRef]);

  // After visibleCount increases (more messages prepended), restore the
  // scroll position so the viewport doesn't jump.
  useEffect(() => {
    if (prevScrollDistanceRef.current == null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = restoreScrollTop(container.scrollHeight, prevScrollDistanceRef.current);
    prevScrollDistanceRef.current = null;
  }, [visibleCount, scrollContainerRef]);
  // Push session metrics to an external store so AppShell/right-panel chrome
  // does not re-render on every streaming token / stats tick.
  const statsKey = useMemo(() => sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
    ].join("|")
    : null, [sessionStats]);
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    setSessionStatsMetric(sessionStatsRef.current);
  }, [statsKey]);

  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  // useLayoutEffect: paint the ring/panel with file-estimated usage before the
  // browser draws, so cold open doesn't flash 0% while waiting for useEffect.
  useLayoutEffect(() => {
    setContextUsageMetric(contextUsageRef.current);
  }, [ctxKey]);

  const extensionStatusKey = useMemo(
    () => extensionStatuses.map((s) => `${s.key}\0${s.text}`).join("\n"),
    [extensionStatuses],
  );
  const extensionStatusesRef = useRef(extensionStatuses);
  extensionStatusesRef.current = extensionStatuses;
  useLayoutEffect(() => {
    setExtensionStatusesMetric(extensionStatusesRef.current);
  }, [extensionStatusKey]);

  useEffect(() => () => {
    clearSessionMetrics();
  }, []);

  // Memoized: runs on every streaming tick otherwise (fresh array each render).
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role === "user" || m.role === "assistant"),
    [messages],
  );
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;

  // Keep transcript padding + opaque underlay (toolbar line → bottom) in sync.
  useLayoutEffect(() => {
    if (isEmptyNew) return;
    const el = composerDockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const dock = el.getBoundingClientRect();
      const h = Math.ceil(dock.height);
      if (h > 0) setComposerDockH(h);
      // Toolbar arrives by ref (no per-tick querySelector) and the custom
      // property lands on the absolutely-positioned underlay instead of the
      // observed dock, so the observer can never resize its own target.
      const toolbar = composerToolbarRef.current;
      const underlay = composerUnderlayRef.current;
      if (toolbar && underlay) {
        const top = toolbar.getBoundingClientRect().top;
        // From the input/model divider down to the dock bottom.
        const underlayH = Math.max(40, Math.ceil(dock.bottom - top));
        underlay.style.setProperty("--composer-underlay-h", `${underlayH}px`);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isEmptyNew, sessionBusy, advisorNote]);

  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const supportsImageInput = displayModelValue
    ? modelImageSupport[`${displayModelValue.provider}:${displayModelValue.modelId}`] === true
      || modelList.some((m) => m.provider === displayModelValue.provider && m.id === displayModelValue.modelId && m.supportsImage)
    : false;

  // Stable across streaming tokens (stream lives in streamState, not messages).
  // Avoids re-running process/answer grouping on every SSE tick.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);

  const historicalMessageNodes = useMemo(() => {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }

    const visibleRefIndexByMessage = new Map<number, number>();
    let refIdx = 0;
    messages.forEach((msg, idx) => {
      if (msg.role === "user" || msg.role === "assistant") {
        visibleRefIndexByMessage.set(idx, refIdx++);
      }
    });

    // Pass 1 — plan every render item. ChatMinimap walks the full message list
    // and keeps its own running ref index, so `visibleRefIndexByMessage` above
    // must stay global; only element creation below is windowed.
    const plan: RenderPlanItem[] = [];
    for (let idx = 0; idx < messages.length;) {
      const msg = messages[idx];
      // Hidden per-prompt memory recall messages never get a render item.
      if (isMemoryContextMessage(msg)) {
        idx += 1;
        continue;
      }
      if (msg.role !== "user") {
        plan.push({ kind: "message", idx });
        idx += 1;
        continue;
      }

      const userIdx = idx;
      let endIdx = userIdx + 1;
      while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

      const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
      // Turns with no assistant answer, and the still-running tail, stay flat:
      // one item per message, no process grouping.
      const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastUserIdx;
      if (finalAssistantIdx === -1 || isLiveTail) {
        for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
          if (renderIdx !== userIdx && isMemoryContextMessage(messages[renderIdx])) continue;
          plan.push({ kind: "message", idx: renderIdx });
        }
        idx = endIdx;
        continue;
      }

      plan.push({ kind: "message", idx: userIdx });

      const processIndices: number[] = [];
      for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
        if (hasDisplayableProcessMessage(messages[processIdx])) processIndices.push(processIdx);
      }
      const finalSplit = getFinalAssistantParts(messages[finalAssistantIdx] as AssistantMessage);
      const finalAnswerMessage = finalSplit.answerMessage;

      const processCount = processIndices.length + (finalSplit.processMessage ? 1 : 0);
      if (processCount > 0) {
        plan.push({
          kind: "process",
          userIdx,
          finalAssistantIdx,
          processIndices,
          processCount,
          hasAnswer: finalAnswerMessage !== null,
        });
      }

      if (finalAnswerMessage) {
        plan.push({ kind: "answer", idx: finalAssistantIdx, message: finalAnswerMessage });
      }
      for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
        if (isMemoryContextMessage(messages[renderIdx])) continue;
        plan.push({ kind: "message", idx: renderIdx });
      }
      idx = endIdx;
    }

    // Same window arithmetic as before — `visibleCount` counts render items,
    // not messages and not turns — but applied before elements exist.
    const { startIndex, hasMore } = getVisibleRenderWindow(plan.length, visibleCount);

    const attachVisibleRef = (refIndex: number) => (el: HTMLDivElement | null) => {
      messageRefs.current[refIndex] = el;
    };

    const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; liveTail?: boolean; variant?: "answer" | "process" } = {}): ReactNode => {
      const msg = options.messageOverride ?? messages[idx];
      const prevAssistantEntryId =
        msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
          ? entryIds[idx - 1]
          : undefined;
      const isVisible = msg.role === "user" || msg.role === "assistant";
      const currentRefIdx = visibleRefIndexByMessage.get(idx);
      const keyPrefix = options.keyPrefix ?? "message";
      let showTimestamp = false;
      if (msg.role === "assistant") {
        showTimestamp = true;
        for (let j = idx + 1; j < messages.length; j++) {
          const r = messages[j].role;
          if (r === "user") break;
          if (r === "assistant") { showTimestamp = false; break; }
        }
        // Streaming bubble owns the live timestamp for the unfinished tail.
        if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
          showTimestamp = false;
        }
      }
      if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
      // Live multi-step turns stay flat, but intermediate assistants (already
      // finished, more of the turn still coming) should read as process rail —
      // not full answer chrome — so they don't flash as the final reply.
      let variant = options.variant;
      if (
        variant === undefined
        && msg.role === "assistant"
        && (sessionBusy || streamState.isStreaming)
        && idx > lastUserIdx
        && idx < messages.length - 1
      ) {
        const parts = getFinalAssistantParts(msg as AssistantMessage);
        if (parts.processBlocks.length > 0 && parts.answerBlocks.length === 0) {
          variant = "process";
        } else if (parts.processBlocks.length > 0) {
          // Has tools/thinking plus trailing text, but isn't the turn's final
          // answer yet — keep the whole bubble in process style until settle.
          variant = "process";
        }
      }
      const view = (
        <MessageView
          key={`${keyPrefix}-view-${idx}`}
          message={msg}
          toolResults={toolResultsMap}
          modelNames={modelNames}
          cwd={messageCwd}
          onOpenFile={onOpenFile}
          entryId={entryIds[idx]}
          onFork={sessionBusy || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
          forking={forkingEntryId === entryIds[idx]}
          onNavigate={sessionBusy ? undefined : handleNavigate}
          prevAssistantEntryId={sessionBusy ? undefined : prevAssistantEntryId}
          onEditContent={handleEditContent}
          showTimestamp={showTimestamp}
          prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
          sessionId={session?.id ?? sessionIdRef.current ?? undefined}
          variant={variant}
        />
      );
      if (!isVisible) return null;
      const entryId = entryIds[idx];
      // Always mount a data-entry-id host so search can jump to process-rail
      // messages (attachRef false) as well as normal transcript rows.
      const attachRef = options.attachRef !== false && currentRefIdx !== undefined;
      return (
        <div
          key={`${keyPrefix}-${idx}`}
          className={options.liveTail ? "chat-message-item is-live" : "chat-message-item"}
          ref={attachRef ? attachVisibleRef(currentRefIdx!) : undefined}
          data-entry-id={entryId || undefined}
        >
          {view}
        </div>
      );
    };

    const renderProcessGroup = (item: Extract<RenderPlanItem, { kind: "process" }>, liveTail = false): ReactNode => {
      const finalAssistant = messages[item.finalAssistantIdx] as AssistantMessage;
      const finalSplit = getFinalAssistantParts(finalAssistant);
      const processRefIdx = item.processIndices
        .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
        .find((value): value is number => typeof value === "number")
        ?? (item.hasAnswer ? undefined : visibleRefIndexByMessage.get(item.finalAssistantIdx));
      const userTs = (messages[item.userIdx] as AgentMessage & { timestamp?: number }).timestamp;
      const finalTs = finalAssistant.timestamp;
      const durationSeconds =
        userTs && finalTs && finalTs >= userTs
          ? Math.round((finalTs - userTs) / 1000)
          : undefined;
      const processGroup = (
        <ProcessDetailsGroup
          durationSeconds={durationSeconds}
          toolCallCount={getTurnToolCallCount(messages, item.processIndices, finalAssistant, finalSplit.processBlocks)}
          onEscapeStickToBottom={stopScroll}
        >
          {item.processIndices.map((processIdx) => renderMessage(processIdx, { attachRef: false, keyPrefix: "process", variant: "process" }))}
          {finalSplit.processMessage && renderMessage(item.finalAssistantIdx, { attachRef: false, keyPrefix: "process-final", messageOverride: finalSplit.processMessage, showTimestamp: false, variant: "process" })}
        </ProcessDetailsGroup>
      );
      return (
        <div
          key={`process-group-${item.userIdx}-${item.finalAssistantIdx}`}
          className={liveTail ? "chat-message-item is-live" : "chat-message-item"}
          ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
        >
          {processGroup}
        </div>
      );
    };

    // Pass 2 — build elements for the visible window only. The newest few
    // render items (the live tail) stay fully laid out: content-visibility
    // only remembers a row's size AFTER it renders, so virtualizing a row
    // that can still grow snaps it to a stale height when skipped and drifts
    // the scroll lock. Older rows keep the .chat-message-item virtualization.
    const liveTailStartIndex = Math.max(startIndex, plan.length - LIVE_TAIL_RENDER_ITEMS);
    const rendered: ReactNode[] = [];
    for (let planIdx = startIndex; planIdx < plan.length; planIdx++) {
      const item = plan[planIdx];
      const liveTail = planIdx >= liveTailStartIndex;
      if (item.kind === "message") rendered.push(renderMessage(item.idx, { liveTail }));
      else if (item.kind === "answer") rendered.push(renderMessage(item.idx, { messageOverride: item.message, liveTail }));
      else rendered.push(renderProcessGroup(item, liveTail));
    }

    return (
      <>
        {hasMore && (
          <div ref={sentinelRef} className="py-3 text-center text-xs text-text-muted">
            Scroll up to load earlier messages ({startIndex} hidden)
          </div>
        )}
        {rendered}
      </>
    );
  }, [
    messages,
    entryIds,
    toolResultsMap,
    modelNames,
    messageCwd,
    onOpenFile,
    sessionBusy,
    isNew,
    handleFork,
    forkingEntryId,
    handleNavigate,
    handleEditContent,
    session?.id,
    sessionIdRef,
    streamState.isStreaming,
    visibleCount,
    messageRefs,
    stopScroll,
  ]);

  const onDrop = useCallback((files: File[]) => {
    if (sessionBusy || !supportsImageInput) return;
    chatInputRef?.current?.addImages(files);
  }, [sessionBusy, chatInputRef, supportsImageInput]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  // Expose compact + leaf navigation to Context panel without prop-drilling AppShell.
  useEffect(() => {
    if (!(session || isNew)) {
      setCompactHandlers(null);
      setSessionNavHandlers(null);
      return;
    }
    const resultText = compactResult
      ? `Compacted · tokens ${compactResult.tokensBefore} → ${compactResult.estimatedTokensAfter}`
      : null;
    setCompactHandlers({
      compact: () => { void handleCompact(); },
      abort: handleAbortCompaction,
      isCompacting,
      error: compactError,
      resultText,
    });
    setSessionNavHandlers({
      sessionId: session?.id ?? null,
      navigateToLeaf: async (leafId) => {
        if (!leafId) return;
        await handleNavigate(leafId);
      },
    });
    return () => {
      setCompactHandlers(null);
      setSessionNavHandlers(null);
    };
  }, [session, isNew, handleCompact, handleAbortCompaction, isCompacting, compactError, compactResult, handleNavigate]);

  const advisorBanner = advisorNote ? (
    <div
      style={{
        margin: "0 0 8px",
        padding: "8px 10px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${advisorNote.level === "blocker" || advisorNote.level === "concern" ? "var(--destructive-border)" : "var(--border)"}`,
        background: advisorNote.level === "blocker" || advisorNote.level === "concern" ? "var(--destructive-bg)" : "var(--bg-subtle)",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <strong style={{ fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {advisorNote.level === "blocker"
            ? t("advisor.blocker")
            : advisorNote.level === "concern"
              ? t("advisor.concern")
              : t("advisor.note")}
        </strong>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{advisorNote.model}</span>
        <button
          type="button"
          className="chrome-btn"
          onClick={() => setAdvisorNote(null)}
          style={{ marginLeft: "auto", height: 22, minHeight: 22, padding: "0 8px", fontSize: 11 }}
        >
          {t("common.close")}
        </button>
      </div>
      <div style={{ color: "var(--text)" }}>{advisorNote.text}</div>
    </div>
  ) : null;

  // Todo visibility: the extension store is session-long, so we only surface the
  // top-bar capsule when (a) settings allow it AND (b) either the live widget
  // payload has content OR the latest turn actually called the todo tool.
  // Also inspect the in-flight streaming bubble — toolCalls often live only
  // there until message_end, which previously hid the capsule mid-turn.
  const todoUsedInLatestTurn = useMemo(() => {
    const hasTodoCall = (msg: AgentMessage | null | undefined): boolean => {
      if (!msg || msg.role !== "assistant") return false;
      const content = (msg as AssistantMessage).content;
      if (!Array.isArray(content)) return false;
      return content.some((c) => c.type === "toolCall" && String(c.toolName).toLowerCase() === "todo");
    };
    if (hasTodoCall(streamState.streamingMessage as AgentMessage | null)) return true;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user") return false;
      if (hasTodoCall(m)) return true;
    }
    return false;
  }, [messages, streamState.streamingMessage]);

  const visibleWidgets = extensionWidgets.filter((widget) => {
    if (classifyWidgetKey(widget.key) !== "todo") return true;
    if (!showTodos) return false;
    // Live overlay content is authoritative — don't require a toolCall scan.
    if (todoWidgetHasContent(widget.lines)) return true;
    return todoUsedInLatestTurn;
  });
  // Todo + subagents publish to the app top bar.
  // Other chrome stays by placement (composer / above editor).
  //
  // Fallback: rpiv-todo keeps a process-global "foreground session" pointer.
  // In Pi Web (many AgentSessions in one process) the extension overlay often
  // never rebinds, so we synthesize a todo widget from toolResult text.
  const derivedTodoLines = useMemo(
    () => (showTodos
      ? deriveTodoWidgetLines(messages, streamState.streamingMessage as AgentMessage | null)
      : null),
    [messages, showTodos, streamState.streamingMessage],
  );

  const topBarWidgets = useMemo(() => {
    const list = visibleWidgets.filter((widget) => (
      widget.placement === "topBar" || isChromeTopBarWidgetKey(widget.key)
    ));
    const hasTodo = list.some((w) => classifyWidgetKey(w.key) === "todo" && todoWidgetHasContent(w.lines));
    if (!hasTodo && derivedTodoLines && derivedTodoLines.length > 0) {
      list.push({
        key: "rpiv-todos",
        lines: derivedTodoLines,
        placement: "topBar",
      });
    }
    return list;
  }, [visibleWidgets, derivedTodoLines]);
  const aboveEditorWidgets = visibleWidgets.filter((widget) => (
    !isChromeTopBarWidgetKey(widget.key)
    && widget.placement !== "belowEditor"
    && widget.placement !== "topBar"
  ));
  const belowEditorWidgets = visibleWidgets.filter((widget) => (
    !isChromeTopBarWidgetKey(widget.key) && widget.placement === "belowEditor"
  ));

  const chromeWidgetKey = useMemo(
    () => topBarWidgets.map((w) => `${w.key}\0${w.lines.join("\n")}`).join("\n---\n"),
    [topBarWidgets],
  );
  const topBarWidgetsRef = useRef(topBarWidgets);
  topBarWidgetsRef.current = topBarWidgets;
  useLayoutEffect(() => {
    setChromeWidgetsMetric(topBarWidgetsRef.current);
  }, [chromeWidgetKey]);

  const chatInputElement = (
    <>
    {advisorBanner}
    <ChatInput
      ref={chatInputRef}
      toolbarRef={composerToolbarRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      onOpenContext={onSessionStatsPanelOpen}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      supportsImageInput={supportsImageInput}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      mode={sessionMode}
      onModeChange={async (next) => {
        // setAgentMode owns silent permission reload — no second path / no notice.
        const result = await setAgentMode(next);
        if (!result.ok) {
          addNotice({ type: "error", message: result.error ?? "Failed to switch mode" });
        }
      }}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
    </>
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "var(--text-muted)" }}>
        {t("window.loadingSession")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "var(--destructive)" }}>
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && !sessionBusy && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[color-mix(in_oklab,var(--accent)_40%,transparent)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="opacity-80"
            style={{ filter: "drop-shadow(0 6px 18px color-mix(in oklab, var(--text) 10%, transparent))" }}
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="color-mix(in oklab, var(--accent) 8%, transparent)" stroke="color-mix(in oklab, var(--accent) 45%, transparent)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="color-mix(in oklab, var(--accent) 14%, transparent)" stroke="color-mix(in oklab, var(--accent) 35%, transparent)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="color-mix(in oklab, var(--accent) 18%, transparent)" stroke="color-mix(in oklab, var(--accent) 50%, transparent)" strokeWidth="1.6"/>
            <g stroke="color-mix(in oklab, var(--accent) 40%, transparent)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-[820px]">
            <div
              className="mb-3"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "0 14px",
                fontFamily: "var(--font-mono)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, lineHeight: 1, overflow: "hidden" }}>
                <Image src="/icon.png" alt="" width={22} height={22} style={{ display: "block", borderRadius: "var(--radius-xs)", flexShrink: 0 }} />
                <span style={{ fontSize: 18, color: "var(--text)", fontWeight: 600, letterSpacing: "-0.01em", flexShrink: 0, whiteSpace: "nowrap", lineHeight: 1 }}>Pi Web</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 2, flexShrink: 0, lineHeight: 1.2 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.2 }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.2 }}>
                  pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                </span>
              </div>
            </div>
            <NoticeShelf notices={notices} align="right" />
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      {/* Full-height row: main column + always-on right rail to page bottom */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ overflow: "visible" }}>
        <div className="relative min-h-0 flex-1 overflow-hidden" style={{ isolation: "isolate" }}>
        {isMobile && (
          <button
            type="button"
            className={`chrome-btn is-icon${stickToBottom ? " is-active" : ""}`}
            onClick={resumeStickToBottom}
            title={t("window.scrollToBottom")}
            aria-label={t("window.scrollToBottom")}
            aria-pressed={stickToBottom}
            style={{
              position: "absolute",
              right: 14,
              bottom: composerDockH + 12,
              zIndex: 45,
              width: 32,
              height: 32,
              minWidth: 32,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-panel)",
              boxShadow: "var(--shadow-sm)",
              color: stickToBottom ? "var(--text-dim)" : "var(--text-muted)",
            }}
          >
            <Icon icon={ArrowDown} size={14} strokeWidth={2} />
          </button>
        )}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: 0,
            zIndex: 40,
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        {/* Outer clips native scrollbar; inner scrolls under the floating composer. */}
        <div className="chat-scroll-clip h-full min-w-0 overflow-hidden" style={{ position: "relative", zIndex: 0 }}>
        <div
          ref={bindScrollContainer}
          className="chat-scroll-area h-full overflow-y-auto pt-4"
          style={{
            // Push native scrollbar into the clipped gutter (WebKit/Electron fallback)
            marginRight: -24,
            paddingRight: 24,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            position: "relative",
            zIndex: 0,
          } as CSSProperties}
        >
          <div ref={chatContentRef} style={{ padding: `0 ${CHAT_COLUMN_PADDING}px`, paddingBottom: composerDockH + 12 }}>
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <ExtensionWidgets widgets={aboveEditorWidgets} />

            {historicalMessageNodes}
            {streamState.isStreaming && streamState.streamingMessage && (
              <div className="chat-message-item is-streaming">
                <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} />
              </div>
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase, t, locale)}</span>
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{t("window.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}
            </div>
          </div>
        </div>
        </div>

        {/* Floating composer: widgets sit above the input card (separate). */}
        <div ref={composerDockRef} className="chat-composer-float">
          <div ref={composerUnderlayRef} className="chat-composer-float-underlay" aria-hidden />
          <div className="chat-composer-float-body">
            <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
              <div style={{ maxWidth: 820, margin: "0 auto" }}>
                <ExtensionWidgets widgets={belowEditorWidgets} />
              </div>
            </div>
            {chatInputElement}
          </div>
        </div>
        </div>
        </div>

        {/* Full-height right rail: same width grammar as topbar file-panel control
            (1px chrome-divider + 36px icon column). */}
        {isMobile ? null : (
          <div
            className="chat-scroll-rail"
            style={{
              width: CHAT_RAIL_WIDTH,
              flexShrink: 0,
              display: "flex",
              flexDirection: "row",
              alignSelf: "stretch",
              background: "var(--bg-panel)",
              minHeight: 0,
            }}
          >
            <div className="chrome-divider" aria-hidden style={{ alignSelf: "stretch" }} />
            <div
              style={{
                width: CHAT_RAIL_BTN_WIDTH,
                minWidth: CHAT_RAIL_BTN_WIDTH,
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <ChatMinimap
                messages={messages}
                streamingMessage={streamState.streamingMessage}
                scrollContainer={scrollContainerRef}
                messageRefs={messageRefs}
              />
              <button
                type="button"
                className={`chrome-btn is-icon${stickToBottom ? " is-active" : ""}`}
                onClick={resumeStickToBottom}
                title={t("window.scrollToBottom")}
                aria-label={t("window.scrollToBottom")}
                aria-pressed={stickToBottom}
                style={{
                  width: CHAT_RAIL_BTN_WIDTH,
                  minWidth: CHAT_RAIL_BTN_WIDTH,
                  height: 36,
                  minHeight: 36,
                  borderTop: "1px solid var(--border)",
                  borderRadius: 0,
                  color: stickToBottom ? "var(--text-dim)" : "var(--text-muted)",
                }}
              >
                <Icon icon={ArrowDown} size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
        )}

      </div>
      </>
      )}
    </div>
  );
}
