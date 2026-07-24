"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, ToolResultMessage } from "@/lib/types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { countToolCallBlocks, getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "@/lib/message-display";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { useAgentSession, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/hooks/useLocale";
import type { MessageKey } from "@/lib/i18n/messages";
import type { SessionStatsInfo } from "@/lib/pi-types";
import {
  captureScrollDistance,
  getNextVisibleCount,
  getVisibleRenderWindow,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
import { SpecializedExtensionWidget, SpecializedStatusChip } from "./extension/ExtensionWidgetViews";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
}

function phaseLabel(phase: AgentPhase, t: (key: MessageKey, params?: Record<string, string | number>) => string, locale: string): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    const sep = locale === "zh" ? "、" : ", ";
    if (names.length === 0) return t("window.runningTool");
    if (names.length === 1) return t("window.runningNamed", { name: names[0] });
    if (names.length <= 3) return t("window.runningNamedMany", { names: names.join(sep) });
    return t("window.runningNamedMore", { names: names.slice(0, 2).join(sep), n: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("window.waitingModel");
  if (phase?.kind === "running_command") return t("window.runningCommand");
  return t("window.thinking");
}

/** Match app-topbar trailing icon column: 1px divider + 36px button = 37px total. */
const CHAT_RAIL_BTN_WIDTH = 36;
const CHAT_RAIL_WIDTH = CHAT_RAIL_BTN_WIDTH + 1; // + left divider
const CHAT_COLUMN_PADDING = 16;

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return getFinalAssistantParts(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  return count;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

// Derived process/answer messages must keep a stable identity across renders,
// otherwise MessageView's memo (which compares `message` by reference) is
// defeated and every completed turn re-renders on each streaming token.
interface FinalAssistantParts {
  processBlocks: AssistantContentBlock[];
  answerBlocks: AssistantContentBlock[];
  processMessage: AssistantMessage | null;
  answerMessage: AssistantMessage | null;
}

const finalAssistantPartsCache = new WeakMap<AssistantMessage, FinalAssistantParts>();

function getFinalAssistantParts(message: AssistantMessage): FinalAssistantParts {
  let parts = finalAssistantPartsCache.get(message);
  if (!parts) {
    const split = splitFinalAssistantBlocks(message);
    parts = {
      processBlocks: split.processBlocks,
      answerBlocks: split.answerBlocks,
      processMessage: split.processBlocks.length > 0
        ? withAssistantBlocks(message, split.processBlocks, { omitUsage: true })
        : null,
      answerMessage: split.answerBlocks.length > 0
        ? withAssistantBlocks(message, split.answerBlocks)
        : null,
    };
    finalAssistantPartsCache.set(message, parts);
  }
  return parts;
}

function ProcessDetailsGroup({ messageCount, toolCallCount, children }: { messageCount: number; toolCallCount: number; children: ReactNode }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const parts = [t("window.processDetails"), t("window.messagesCount", { n: messageCount })];
  if (toolCallCount > 0) parts.push(t("window.toolCallsCount", { n: toolCallCount }));

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
        title={expanded ? t("window.collapseProcess") : t("window.expandProcess")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {parts.join(" · ")}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onOpenFile }: Props) {
  const { t, locale } = useLocale();
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, modelImageSupport, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    stickToBottom, resumeStickToBottom,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd: wrappedOnAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
  });
  const sessionBusy = agentRunning || bashRunning;

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);

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
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
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
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
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

  const onDrop = useCallback((files: File[]) => {
    if (sessionBusy || !supportsImageInput) return;
    chatInputRef?.current?.addImages(files);
  }, [sessionBusy, chatInputRef, supportsImageInput]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const handlePermissionModeApplied = useCallback(() => {
    void handleBuiltinSlashCommand("/reload");
  }, [handleBuiltinSlashCommand]);

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
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
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      onPermissionModeApplied={session || isNew ? handlePermissionModeApplied : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      supportsImageInput={supportsImageInput}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

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
                <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: 0, color: "var(--text)", flexShrink: 0, whiteSpace: "nowrap", lineHeight: 1 }}>π</span>
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
        <div className="relative min-h-0 flex-1 overflow-hidden">
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
              bottom: 12,
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
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
        {/* Outer clips native scrollbar; inner scrolls. Right rail is the only scroll UI. */}
        <div className="chat-scroll-clip h-full min-w-0 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="chat-scroll-area h-full overflow-y-auto pt-4"
          style={{
            // Push native scrollbar into the clipped gutter (WebKit/Electron fallback)
            marginRight: -24,
            paddingRight: 24,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          } as CSSProperties}
        >
          <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <ExtensionStatusBar statuses={extensionStatuses} />
              <ExtensionWidgets widgets={aboveEditorWidgets} />

            {(() => {
              const toolResultsMap = new Map<string, ToolResultMessage>();
              for (const msg of messages) {
                if (msg.role === "toolResult") {
                  toolResultsMap.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
                }
              }

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

              const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
                messageRefs.current[refIndex] = el;
                if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean } = {}): ReactNode => {
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
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
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
                  />
                );
                if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
                return (
                  <div key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(idx, currentRefIdx)}>
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              for (let idx = 0; idx < messages.length;) {
                const msg = messages[idx];
                if (msg.role !== "user") {
                  rendered.push(renderMessage(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                let endIdx = userIdx + 1;
                while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

                const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                if (finalAssistantIdx === -1) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastUserIdx;
                if (isLiveTail) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                rendered.push(renderMessage(userIdx));

                const processIndices: number[] = [];
                for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
                  processIndices.push(processIdx);
                }
                const visibleProcessIndices = processIndices.filter((processIdx) => hasDisplayableProcessMessage(messages[processIdx]));
                const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                const finalSplit = getFinalAssistantParts(finalAssistant);
                const finalProcessMessage = finalSplit.processMessage;
                const finalAnswerMessage = finalSplit.answerMessage;

                const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
                if (processCount > 0) {
                  const processRefIdx = visibleProcessIndices
                    .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
                    .find((value): value is number => typeof value === "number")
                    ?? (finalAnswerMessage ? undefined : visibleRefIndexByMessage.get(finalAssistantIdx));
                  const processGroup = (
                    <ProcessDetailsGroup
                      messageCount={processCount}
                      toolCallCount={countToolCalls(messages, visibleProcessIndices) + countToolCallBlocks(finalSplit.processBlocks)}
                    >
                      {visibleProcessIndices.map((processIdx) => renderMessage(processIdx, { attachRef: false, keyPrefix: "process" }))}
                      {finalProcessMessage && renderMessage(finalAssistantIdx, { attachRef: false, keyPrefix: "process-final", messageOverride: finalProcessMessage, showTimestamp: false })}
                    </ProcessDetailsGroup>
                  );
                  rendered.push(
                    <div
                      key={`process-group-${userIdx}-${finalAssistantIdx}`}
                      ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                    >
                      {processGroup}
                    </div>,
                  );
                }

                if (finalAnswerMessage) {
                  rendered.push(renderMessage(finalAssistantIdx, { messageOverride: finalAnswerMessage }));
                }
                for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                  rendered.push(renderMessage(renderIdx));
                }
                idx = endIdx;
              }
              const { startIndex, hasMore } = getVisibleRenderWindow(rendered.length, visibleCount);
              return (
                <>
                  {hasMore && (
                    <div ref={sentinelRef} className="py-3 text-center text-xs text-text-muted">
                      Scroll up to load earlier messages ({startIndex} hidden)
                    </div>
                  )}
                  {rendered.slice(startIndex)}
                </>
              );
            })()}
            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} />
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

            {/* Small tail padding so the last line isn't flush against the input bar. */}
            <div ref={messagesEndRef} style={{ height: 12 }} />
            </div>
          </div>
        </div>
        </div>
        </div>

        <div className="relative flex-shrink-0" style={{ overflow: "visible", zIndex: 40 }}>
          <div
            style={{
              padding: `0 ${CHAT_COLUMN_PADDING}px`,
            }}
          >
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <ExtensionWidgets widgets={belowEditorWidgets} />
            </div>
          </div>
          {chatInputElement}
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 5v14" />
                  <path d="m19 12-7 7-7-7" />
                </svg>
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

function isPermissionStatus(status: { key: string; text: string }): boolean {
  const k = status.key.toLowerCase();
  const t = status.text.toLowerCase();
  // Permission mode is already controlled in the composer toolbar — hide the
  // redundant "Permission / yolo" chip from the chat chrome.
  return (
    k.includes("permission")
    || k.includes("pi-permission")
    || t === "yolo"
    || t.includes("yolo mode")
  );
}

function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  const visible = statuses.filter((s) => !isPermissionStatus(s));
  if (visible.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
      {visible.map((status) => (
        <SpecializedStatusChip key={status.key} statusKey={status.key} text={status.text} />
      ))}
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
      {widgets.map((widget) => (
        <SpecializedExtensionWidget key={widget.key} widgetKey={widget.key} lines={widget.lines} />
      ))}
    </div>
  );
}

function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "var(--destructive)"
          : notice.type === "warning"
            ? "var(--text)"
            : notice.type === "success"
              ? "var(--success)"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 60,
              height: 60,
              maxHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating ? "var(--shadow-md)" : "var(--shadow-sm)",
              fontSize: 13,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ padding: "14px 0", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

/** Split jammed permission titles like "Permission Required Current agent..." into heading + body. */
function splitExtensionCopy(title: string, message?: string): { heading: string; body: string } {
  const full = [title, message].filter((part) => Boolean(part && part.trim())).join("\n\n").trim();
  const headingMatch = full.match(/^(Permission Required|权限请求|需要权限|批准请求|Allow|Deny)([\s.:：-]*)/i);
  if (headingMatch) {
    const heading = headingMatch[1].replace(/\b\w/g, (c) => c.toUpperCase());
    const body = full.slice(headingMatch[0].length).trim();
    return { heading: heading || title, body: body || message || "" };
  }
  if (title.length > 72) {
    return { heading: `${title.slice(0, 48).trim()}…`, body: full };
  }
  return { heading: title, body: (message ?? "").trim() };
}

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  const rawMessage = request.method === "confirm" ? request.message : "";
  const isPermissionLike =
    /permission|allow|deny|policy|批准|权限|允许|拒绝|bash|tool|命令|工具/i.test(`${request.title}\n${rawMessage}`);
  const { heading, body } = splitExtensionCopy(request.title, rawMessage || undefined);
  const showBodyPanel = Boolean(body) || (request.method === "confirm" && Boolean(rawMessage));
  const bodyText = body || rawMessage;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-bg)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-shell"
        style={{
          width: isPermissionLike ? "min(640px, 100%)" : "min(520px, 100%)",
          maxHeight: "min(80vh, 720px)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        {/* Header strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
            height: 44,
            padding: "0 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}
        >
          {isPermissionLike && (
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "color-mix(in oklab, var(--destructive) 12%, var(--bg))",
                color: "var(--destructive)",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              !
            </span>
          )}
          <div
            style={{
              minWidth: 0,
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={heading}
          >
            {heading}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {showBodyPanel && bodyText && (
            <div
              style={{
                color: "var(--text)",
                fontSize: isPermissionLike ? 12 : 13.5,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                padding: isPermissionLike ? "10px 12px" : 0,
                borderRadius: isPermissionLike ? "var(--radius-sm)" : 0,
                background: isPermissionLike ? "var(--bg-panel)" : "transparent",
                border: isPermissionLike ? "1px solid var(--border)" : "none",
                fontFamily: isPermissionLike ? "var(--font-mono)" : "inherit",
                maxHeight: isPermissionLike ? "min(28vh, 220px)" : undefined,
                overflow: isPermissionLike ? "auto" : undefined,
              }}
            >
              {bodyText}
            </div>
          )}

          {request.method === "select" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {request.options.map((option) => {
                const isAllow = /^(yes|allow|允许|是)/i.test(option.trim());
                const isDeny = /^(no|deny|拒绝|否)/i.test(option.trim());
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onRespond(request, { value: option })}
                    style={{
                      width: "100%",
                      minHeight: 36,
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: isDeny ? "var(--destructive)" : "var(--text)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 13,
                      lineHeight: 1.4,
                      fontWeight: isAllow ? 500 : 400,
                      transition: "background 0.1s ease, border-color 0.1s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.borderColor = isDeny
                        ? "var(--destructive-border)"
                        : "var(--border)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--bg)";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}

          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          )}

          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 200,
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>

        {/* Footer strip */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            minHeight: 52,
            padding: "0 16px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onRespond(request, { cancelled: true })}
          >
            {t("common.cancel")}
          </button>
          {request.method === "confirm" ? (
            <>
              {isPermissionLike && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onRespond(request, { confirmed: false })}
                  style={{ color: "var(--destructive)", borderColor: "var(--destructive-border)" }}
                >
                  {t("ext.deny")}
                </button>
              )}
              <button type="button" className="btn-primary" onClick={submitValue}>
                {isPermissionLike ? t("ext.allow") : t("window.confirm")}
              </button>
            </>
          ) : request.method !== "select" ? (
            <button type="button" className="btn-primary" onClick={submitValue}>
              {t("window.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-bg)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={t("window.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{t("window.extensionPanel")}</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
