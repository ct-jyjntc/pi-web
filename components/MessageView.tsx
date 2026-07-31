"use client";

import { useLocale } from "@/hooks/useLocale";

import { memo, useState, useRef, useEffect, useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { PreviewableImage } from "./PreviewableImage";
import { ReviewSummaryCard } from "./ReviewSummaryCard";
import { copyText } from "@/lib/clipboard";
import type { MessageKey, TranslateParams } from "@/lib/i18n/messages";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import {
  formatThoughtDuration,
  getAssistantErrorMessage,
  isEmptyThinkingBlock,
  isMemoryContextMessage,
} from "@/lib/message-display";
import { MAX_DIFF_ROWS, parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import { parseReviewReport } from "@/lib/review-report";
import { useWebSettings } from "@/lib/web-settings-store";
import { isRecord } from "@/lib/type-guards";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  BashExecutionMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";

const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { thinking?: unknown };
    if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
    return data.thinking;
  }).catch((error) => {
    thinkingContentCache.delete(key);
    throw error;
  });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  /**
   * `process` = intermediate turn chrome (thinking/tools/narration). Quieter
   * scaffold styling, no model/usage chrome. Default is full answer surface.
   */
  variant?: "answer" | "process";
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, modelNames, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp, sessionId, variant }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} cwd={cwd} onOpenFile={onOpenFile} entryId={entryId} onFork={onFork} forking={forking} onNavigate={onNavigate} prevAssistantEntryId={prevAssistantEntryId} onEditContent={onEditContent} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} cwd={cwd} onOpenFile={onOpenFile} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} sessionId={sessionId} entryId={entryId} variant={variant} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    // Hidden per-prompt memory recall never renders (model-only context).
    if (isMemoryContextMessage(message)) return null;
    if ((message as CustomMessage).customType === "compaction") {
      return <CompactionMessageView message={message as CustomMessage} />;
    }
    return <CustomMessageView message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.entryId === next.entryId
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    && prev.onNavigate === next.onNavigate
    && prev.prevAssistantEntryId === next.prevAssistantEntryId
    && prev.onEditContent === next.onEditContent
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.sessionId === next.sessionId
    && prev.variant === next.variant;
});

const USER_MSG_COLLAPSE_CHARS = 420;
const USER_MSG_COLLAPSE_LINES = 8;

/**
 * Wrapper that owns the hover/focus state used to reveal a message's action row.
 * The message body is passed as `children`, so its element identity stays stable
 * across hover updates and React bails out of re-rendering that subtree — a
 * mouseenter no longer rebuilds thousands of diff rows below.
 */
function MessageHoverShell({ style, renderActions, children }: {
  style: CSSProperties;
  renderActions: (active: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);

  return (
    <div
      style={style}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        // React onBlur is focusout: ignore focus moves between our own children.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setActive(false);
      }}
    >
      {children}
      {renderActions(active)}
    </div>
  );
}

function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const contentBlocks = Array.isArray(message.content) ? message.content : [];
  const content =
    typeof message.content === "string"
      ? message.content
      : contentBlocks
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : contentBlocks.filter((b): b is ImageContent => b.type === "image");

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;
  const lineCount = content ? content.split("\n").length : 0;
  const isLong =
    content.length > USER_MSG_COLLAPSE_CHARS || lineCount > USER_MSG_COLLAPSE_LINES;
  const showCollapsed = isLong && !expanded;
  const collapsedPreview = content
    .split("\n")
    .slice(0, USER_MSG_COLLAPSE_LINES)
    .join("\n")
    .slice(0, USER_MSG_COLLAPSE_CHARS);

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <MessageHoverShell
      style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
      renderActions={(active) => (
        // Bottom row: action buttons + timestamp
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          <div style={{
            display: "flex", gap: 3,
            opacity: active ? 1 : 0,
            pointerEvents: active ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
            <button
              onClick={copyContent}
              title={t("msg.copyMessage")}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: 22,
                background: "none", border: "none",
                borderRadius: "var(--radius-sm)",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11, fontWeight: 400,
                whiteSpace: "nowrap",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div style={{
              display: "flex", gap: 3,
              opacity: (active || forking) ? 1 : 0,
              pointerEvents: (active || forking) ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              {canNavigate && (
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(content); }}
                  title={t("msg.editFromHereTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 10 20 15 15 20" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  {t("msg.editFromHere")}
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                  title={forking ? t("msg.creatingSession") : t("msg.newSessionTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: "var(--radius-sm)",
                    color: forking ? "var(--accent)" : "var(--text-dim)",
                    cursor: forking ? "not-allowed" : "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {forking ? t("msg.creating") : t("msg.newSession")}
                </button>
              )}
            </div>
          )}
          {time && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{time}</span>}
        </div>
      )}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "85%" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--user-bg)",
            border: "1px solid color-mix(in oklab, var(--border) 80%, transparent)",
            borderRadius: "var(--radius-lg)",
            padding: "8px 12px",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--text)",
            wordBreak: "break-word",
          }}
        >
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                const src = imageSource(img);
                if (!src) return null;
                return (
                  <PreviewableImage
                    key={i}
                    src={src}
                    alt=""
                    className="chat-sent-image"
                    previewLabel={t("msg.imagePreview")}
                  />
                );
              })}
            </div>
          )}
          {content && (
            showCollapsed ? (
              <div>
                <div
                  style={{
                    maxHeight: 140,
                    overflow: "hidden",
                    position: "relative",
                    maskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
                    WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
                  }}
                >
                  <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>
                    {collapsedPreview}
                  </MarkdownBody>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  style={{
                    marginTop: 6,
                    padding: "2px 0",
                    border: "none",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {t("msg.showMore")}
                </button>
              </div>
            ) : (
              <div>
                <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>{content}</MarkdownBody>
                {isLong && (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    style={{
                      marginTop: 6,
                      padding: "2px 0",
                      border: "none",
                      background: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {t("msg.showLess")}
                  </button>
                )}
              </div>
            )
          )}
        </div>

      </div>
    </MessageHoverShell>
  );
}

/**
 * Cheap stand-in for `JSON.stringify(value).length`: walks the value and sums
 * string lengths (O(1) each) instead of allocating a copy of a possibly 100KB+
 * tool input on every streaming frame.
 */
function approxJsonLength(value: unknown, depth: number): number {
  if (typeof value === "string") return value.length + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (value === null || value === undefined) return 4;
  if (depth > 4 || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    let total = 2;
    for (const item of value) total += approxJsonLength(item, depth + 1) + 1;
    return total;
  }
  let total = 2;
  const record = value as Record<string, unknown>;
  for (const key in record) total += key.length + 4 + approxJsonLength(record[key], depth + 1);
  return total;
}

/** Approximate streamed character count behind the est-tokens / t-per-s readouts. */
function estimateStreamChars(blocks: AssistantContentBlock[]): number {
  let chars = 0;
  for (const b of blocks) {
    if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
    else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
    else if (b.type === "toolCall") chars += approxJsonLength((b as ToolCallContent).input ?? {}, 0);
  }
  return chars;
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  showTimestamp,
  prevTimestamp,
  sessionId,
  entryId,
  variant = "answer",
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  entryId?: string;
  variant?: "answer" | "process";
}) {
  const { t } = useLocale();
  const isProcess = variant === "process";
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = useMemo(
    () => (message.content ?? [])
      .map((block, originalIndex) => ({ block, originalIndex }))
      .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming })),
    [message.content, isStreaming],
  );
  // Live stream + process variant: once thinking/tools have appeared, treat
  // everything up through the last non-text/image block as process scaffolding
  // so intermediate narration never flash-renders as full-strength final markdown.
  const processOriginalIndexes = useMemo(() => {
    if (isProcess) return new Set(blockItems.map((item) => item.originalIndex));
    let lastProcessPos = -1;
    for (let i = 0; i < blockItems.length; i++) {
      const type = blockItems[i]!.block.type;
      if (type !== "text" && type !== "image") lastProcessPos = i;
    }
    if (lastProcessPos === -1) return new Set<number>();
    const processSet = new Set<number>();
    for (let i = 0; i <= lastProcessPos; i++) processSet.add(blockItems[i]!.originalIndex);
    return processSet;
  }, [blockItems, isProcess]);
  // Fold consecutive "run" tool calls (read/grep/bash/…) into collapsible groups.
  // Cards (edits, writes, questions) and text/thinking blocks break groups.
  const displayItems = useMemo(() => groupRunBlocks(blockItems), [blockItems]);
  const blocks = useMemo(() => blockItems.map(({ block }) => block), [blockItems]);
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = useMemo(
    () => blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n"),
    [blocks],
  );

  // Answer-track text (for copy) excludes process-track narration.
  const answerTextContent = useMemo(
    () => blockItems
      .filter(({ block, originalIndex }) => block.type === "text" && !processOriginalIndexes.has(originalIndex))
      .map(({ block }) => (block as TextContent).text)
      .join("\n"),
    [blockItems, processOriginalIndexes],
  );
  const copyableText = isProcess ? textContent : (answerTextContent || textContent);

  // Streamed character estimate — computed once per render and reused by the
  // tps interval, so no tick re-scans the blocks.
  const estChars = useMemo(() => (isStreaming ? estimateStreamChars(blocks) : 0), [isStreaming, blocks]);
  const estCharsRef = useRef(estChars);
  estCharsRef.current = estChars;
  const estTokens = Math.round(estChars / 4);

  const reviewReport = useMemo(
    () => (!isStreaming && !isProcess ? parseReviewReport(textContent) : null),
    [isStreaming, isProcess, textContent],
  );

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) {
            next.set(idx, Math.round((now - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      const chars = estCharsRef.current;
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed <= 0.5) return;
      const next = chars / 4 / elapsed;
      // Only re-render when the displayed (one decimal) value actually moves.
      setTps((prev) => (prev !== null && Math.round(prev * 10) === Math.round(next * 10) ? prev : next));
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (blocks.length === 0 && !isStreaming && !providerError) return null;

  return (
    <MessageHoverShell
      style={{ marginBottom: isProcess ? 8 : 16 }}
      renderActions={(active) => (
        isProcess ? null : (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginTop: 4,
        }}>
          {message.usage && !isStreaming && (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {formatUsage(message.usage)}
            </div>
          )}
          {copyableText && !isStreaming && (
            <button
              onClick={() => {
                copyText(copyableText).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              title={t("msg.copyMessage")}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: 22,
                background: "none", border: "none",
                borderRadius: "var(--radius-sm)",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11, fontWeight: 400,
                whiteSpace: "nowrap",
                opacity: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
                transition: "opacity 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          )}
          {time && !isStreaming && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>{time}</span>
          )}
        </div>
        )
      )}
    >
      {/* Model label — answer surface only (process rail stays quiet). */}
      {!isProcess && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {message.provider && (
            <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
          )}
          {isStreaming && estTokens > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title={t("msg.estTokens")}>
              <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                </svg>
                {estTokens}
              </span>
              {tps !== null && (
                <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: "var(--radius-pill)", background: "var(--bg-selected)", color: "var(--text-muted)", fontSize: 11, fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
                  {tps.toFixed(1)} t/s
                </span>
              )}
            </span>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isProcess ? 6 : 8,
        }}
      >
        {displayItems.map((item) =>
          item.kind === "run" ? (
            <ToolRunGroup
              // Keyed by the first call's id, never by position: live streaming and
              // rehydrated history must agree on which calls belong to the group.
              key={`${entryId ?? "stream"}-run-${(item.items[0]!.block as ToolCallContent).toolCallId}`}
              items={item.items}
              toolResults={toolResults}
              toolCallDurations={toolCallDurations}
              isStreaming={isStreaming}
            />
          ) : (
            <BlockView
              key={`${entryId ?? "stream"}-${item.item.originalIndex}`}
              block={item.item.block}
              toolResults={toolResults}
              isStreaming={isStreaming}
              streamingDuration={streamingDurations.get(item.item.originalIndex) ?? (item.item.block.type === "thinking" ? thinkingDurationFromFile : undefined)}
              toolCallDurations={toolCallDurations}
              cwd={cwd}
              onOpenFile={onOpenFile}
              sessionId={sessionId}
              entryId={entryId}
              blockIndex={item.item.originalIndex}
              processStyle={processOriginalIndexes.has(item.item.originalIndex) || isProcess}
            />
          ),
        )}
        {reviewReport && !isProcess && <ReviewSummaryCard report={reviewReport} />}
      </div>

      {providerError && !isProcess && (
        <div
          role="alert"
          style={{
            marginTop: blocks.length > 0 ? 8 : 0,
            padding: "7px 10px",
            border: "1px solid var(--destructive-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--destructive-bg)",
            color: "var(--destructive)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          Error: {providerError}
        </div>
      )}
    </MessageHoverShell>
  );
}

function BlockView({ block, toolResults, isStreaming, streamingDuration, toolCallDurations, cwd, onOpenFile, sessionId, entryId, blockIndex, processStyle }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; cwd?: string; onOpenFile?: (filePath: string) => void; sessionId?: string; entryId?: string; blockIndex: number; processStyle?: boolean }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} processStyle={processStyle} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} isStreaming={isStreaming} sessionId={sessionId} entryId={entryId} blockIndex={blockIndex} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    // Todo UI lives in the session top bar (extension widget) — don't also
    // render a bulky tool card in the transcript (Hermes does the same).
    if (tc.toolName.toLowerCase() === "todo") return null;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return (
      <ToolCallBlock
        block={tc}
        result={result}
        duration={duration}
        isStreaming={isStreaming && !result}
      />
    );
  }
  return null;
}

type TFn = (key: MessageKey, params?: TranslateParams) => string;

interface BlockItem {
  block: AssistantContentBlock;
  originalIndex: number;
}

type DisplayItem =
  | { kind: "block"; item: BlockItem }
  | { kind: "run"; items: BlockItem[] };

/**
 * Card tools always render in full: file edits/writes carry the diffs the user
 * reviews, and question-style tools need an answer. Everything else (read,
 * grep, find, ls, bash, extension tools, unknown names) is ephemeral "run"
 * activity that a group can summarize.
 */
function isCardToolName(toolName: string): boolean {
  const n = toolName.toLowerCase();
  if (isEditToolName(toolName)) return true;
  if (n === "write" || n.startsWith("write_") || n.endsWith("_write") || n.endsWith(".write") || n.includes("write_file")) return true;
  if (n.includes("ask") || n.includes("question") || n.includes("clarif") || n.includes("user")) return true;
  return false;
}

/**
 * Split a message's blocks into singleton blocks and groups of consecutive
 * run-tool calls. Order is preserved — a read→edit→read turn shows a group,
 * the diff card, then a second group.
 *
 * Hermes folds even a lone activity call into a one-line scaffold row, so any
 * non-empty run (≥1) goes through ToolRunGroup / ScaffoldToolRow rather than
 * the heavy card chrome reserved for edit/write/ask.
 */
function groupRunBlocks(blockItems: BlockItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let run: BlockItem[] = [];
  const flush = () => {
    if (run.length >= 1) out.push({ kind: "run", items: run });
    run = [];
  };
  for (const item of blockItems) {
    // Todo is hoisted to the session top bar — skip entirely from run groups.
    if (item.block.type === "toolCall" && (item.block as ToolCallContent).toolName.toLowerCase() === "todo") {
      flush();
      continue;
    }
    if (item.block.type === "toolCall" && !isCardToolName((item.block as ToolCallContent).toolName)) {
      run.push(item);
    } else {
      flush();
      out.push({ kind: "block", item });
    }
  }
  flush();
  return out;
}

type RunCategory = "command" | "explore" | "other";

function runCategory(toolName: string): RunCategory {
  const n = toolName.toLowerCase();
  if (n.startsWith("bash") || n.includes("shell") || n.includes("terminal") || n.includes("exec")) return "command";
  if (n === "read" || n === "grep" || n === "find" || n === "ls" || n.includes("search") || n.includes("list") || n.includes("glob")) return "explore";
  return "other";
}

/** Settled group line — "Ran 5 commands · Read 3 files". Clause order is fixed. */
function settledRunLine(runs: ToolCallContent[], t: TFn): string {
  // Single call: name the target like Hermes ("Read foo.ts"), not "Read 1 file".
  if (runs.length === 1) return scaffoldToolTitle(runs[0]!, false, t);
  const counts: Record<RunCategory, number> = { command: 0, explore: 0, other: 0 };
  for (const tc of runs) counts[runCategory(tc.toolName)]++;
  const clauses: string[] = [];
  if (counts.command > 0) clauses.push(t(counts.command === 1 ? "toolRun.ranCommand" : "toolRun.ranCommands", { n: counts.command }));
  if (counts.explore > 0) clauses.push(t(counts.explore === 1 ? "toolRun.readFile" : "toolRun.readFiles", { n: counts.explore }));
  if (counts.other > 0) clauses.push(t(counts.other === 1 ? "toolRun.usedTool" : "toolRun.usedTools", { n: counts.other }));
  return clauses.join(" · ");
}

/** Live group line for the narrating call — "Reading src/foo.ts". */
function liveRunLine(tc: ToolCallContent, t: TFn): string {
  return scaffoldToolTitle(tc, true, t);
}

/** One-line scaffold title for a single tool call (Hermes-style). */
function scaffoldToolTitle(tc: ToolCallContent, live: boolean, t: TFn): string {
  const target = getToolPreview(tc) || tc.toolName;
  const category = runCategory(tc.toolName);
  if (live) {
    const key = category === "command" ? "toolRun.liveRunning" : category === "explore" ? "toolRun.liveReading" : "toolRun.liveUsing";
    return t(key, { target });
  }
  const key = category === "command" ? "toolRun.settledRunning" : category === "explore" ? "toolRun.settledReading" : "toolRun.settledUsing";
  return t(key, { target });
}

/**
 * One collapsed line standing in for a group of consecutive run-tool calls.
 *
 * Live (message streaming with unfinished calls): a one-line ticker narrating
 * the most recent action, plus a done/total counter. Settled: a past-tense
 * summary line. Clicking unfolds the full ToolCallBlock rows.
 *
 * A group containing a failed call auto-unfurls (until the user folds it back)
 * so an error row is never swallowed into the summary.
 */
const ToolRunGroup = memo(function ToolRunGroup({ items, toolResults, toolCallDurations, isStreaming }: {
  items: BlockItem[];
  toolResults?: Map<string, ToolResultMessage>;
  toolCallDurations?: Map<string, number>;
  isStreaming?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState<boolean | null>(null);
  const runs = useMemo(() => items.map((it) => it.block as ToolCallContent), [items]);

  // Hermes: a lone activity call is its own scaffold row — no summary wrapper.
  if (runs.length === 1) {
    const tc = runs[0]!;
    return (
      <ToolCallBlock
        block={tc}
        result={toolResults?.get(tc.toolCallId)}
        duration={toolCallDurations?.get(tc.toolCallId)}
        isStreaming={isStreaming && !toolResults?.get(tc.toolCallId)}
      />
    );
  }

  let doneCount = 0;
  let errorCount = 0;
  let narrating: ToolCallContent | null = null;
  for (const tc of runs) {
    const result = toolResults?.get(tc.toolCallId);
    if (result) {
      doneCount++;
      if (result.isError) errorCount++;
    } else if (!narrating) {
      narrating = tc;
    }
  }
  const live = Boolean(isStreaming) && doneCount < runs.length;
  // Live runs stay expanded (Hermes: cannot collapse while a tool is running).
  // Errors auto-unfurl until the user folds them.
  const expanded = open ?? (live || errorCount > 0);

  let totalDuration = 0;
  for (const tc of runs) totalDuration += toolCallDurations?.get(tc.toolCallId) ?? 0;

  const line = live
    ? liveRunLine(narrating ?? runs[runs.length - 1]!, t)
    : settledRunLine(runs, t);

  return (
    <div
      data-slot="tool-run-group"
      style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, opacity: 0.82 }}
    >
      <button
        type="button"
        onClick={() => {
          // Don't allow collapsing while tools are still running.
          if (live) return;
          setOpen(!expanded);
        }}
        aria-expanded={expanded}
        title={live ? undefined : (expanded ? t("toolRun.hideDetails") : t("toolRun.showDetails"))}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          minHeight: 22,
          padding: "2px 0",
          background: "none",
          border: "none",
          color: "inherit",
          cursor: live ? "default" : "pointer",
          textAlign: "left",
          minWidth: 0,
        }}
      >
        {!live && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              flexShrink: 0,
              opacity: 0.55,
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          >
            <polyline points="3.5 2 6.5 5 3.5 8" />
          </svg>
        )}
        {live && (
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 2,
              background: "var(--text-dim)",
              flexShrink: 0,
              opacity: 0.7,
            }}
            className="tool-run-live"
          />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {live ? (
            // Remount per narrated action so the tick animation replays.
            <span key={narrating?.toolCallId ?? "done"} className="tool-run-tick">
              <span className="tool-run-live">{line}</span>
            </span>
          ) : (
            line
          )}
        </span>
        {live && (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {t("toolRun.progress", { done: doneCount, total: runs.length })}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--destructive)", fontVariantNumeric: "tabular-nums" }}>
            {t(errorCount === 1 ? "toolRun.error" : "toolRun.errors", { n: errorCount })}
          </span>
        )}
        {!live && totalDuration > 0 && (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {formatThoughtDuration(totalDuration)}
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {runs.map((tc) => (
            <ToolCallBlock
              key={tc.toolCallId}
              block={tc}
              result={toolResults?.get(tc.toolCallId)}
              duration={toolCallDurations?.get(tc.toolCallId)}
              isStreaming={isStreaming && !toolResults?.get(tc.toolCallId)}
              nested
            />
          ))}
        </div>
      )}
    </div>
  );
});

function TextBlock({ block, isStreaming, cwd, onOpenFile, processStyle }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string) => void; processStyle?: boolean }) {
  const body = (
    <MarkdownBody
      isStreaming={isStreaming}
      cwd={cwd}
      onOpenFile={onOpenFile}
    >
      {block.text}
    </MarkdownBody>
  );
  if (!processStyle) return body;
  // Inline styles so process prose stays muted even if globals.css HMR lags.
  return (
    <div
      style={{
        color: "var(--text-muted)",
        fontSize: 12,
        lineHeight: 1.5,
        opacity: 0.9,
      }}
    >
      {body}
    </div>
  );
}

/**
 * Hermes-style thinking disclosure: auto-open while streaming, auto-collapse
 * when settled, with "Thought for Ns" labels. First explicit user toggle wins.
 */
function ThinkingBlock({
  block, duration, isStreaming, sessionId, entryId, blockIndex,
}: {
  block: ThinkingContent;
  duration?: number;
  isStreaming?: boolean;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
}) {
  const { t } = useLocale();
  // null = no explicit user toggle yet → defer to streaming/settings default.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webSettings = useWebSettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pending = Boolean(isStreaming);

  const defaultOpen = pending || webSettings?.showThinking === true;
  const open = userOpen ?? defaultOpen;
  const isPreview = pending && userOpen === null;

  const loadDeferred = useCallback(async () => {
    if (!block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(t("msg.thinkingUnavailable"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setContent(await loadThinkingContent(sessionId, entryId, blockIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [block.deferred, blockIndex, content, entryId, sessionId, t]);

  // Load deferred body when the disclosure opens.
  useEffect(() => {
    if (open && block.deferred && content === null && !loading && !error) {
      void loadDeferred();
    }
  }, [open, block.deferred, content, loading, error, loadDeferred]);

  // While the live preview is open, pin the scroll container to the bottom on
  // content growth so the latest tokens stay visible (Hermes ThinkingDisclosure).
  useEffect(() => {
    if (!isPreview || !open) return;
    const el = scrollRef.current;
    const body = contentRef.current;
    if (!el || !body) return;
    let lastHeight = -1;
    const pin = (entries: readonly ResizeObserverEntry[]) => {
      const height = entries[entries.length - 1]?.borderBoxSize?.[0]?.blockSize ?? -1;
      const grew = height < 0 || height > lastHeight;
      lastHeight = height;
      if (grew) el.scrollTop = el.scrollHeight;
    };
    const observer = new ResizeObserver(pin);
    observer.observe(body);
    return () => observer.disconnect();
  }, [isPreview, open]);

  const toggle = () => {
    const next = !open;
    setUserOpen(next);
    if (next) void loadDeferred();
  };

  let label = t("msg.thinkingLive");
  if (!pending) {
    if (duration == null) label = t("msg.thought");
    else if (duration < 1) label = t("msg.thoughtBriefly");
    else label = t("msg.thoughtFor", { duration: formatThoughtDuration(duration) });
  }

  const bodyText = loading
    ? t("msg.loadingThinking")
    : error ?? (block.deferred ? content : block.thinking);

  // Empty non-streaming thinking with no deferred payload is pure noise.
  if (!pending && !block.deferred && !(block.thinking?.trim()) && duration == null) {
    return null;
  }

  return (
    <div
      data-slot="thinking-disclosure"
      style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, opacity: 0.82 }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "auto",
          maxWidth: "100%",
          minHeight: 22,
          padding: "1px 0",
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            opacity: 0.55,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          <polyline points="3.5 2 6.5 5 3.5 8" />
        </svg>
        <span
          className={pending ? "tool-run-live" : undefined}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {pending && duration != null && duration > 0 && (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {formatThoughtDuration(duration)}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={scrollRef}
          style={{
            marginTop: 4,
            maxHeight: isPreview ? "10rem" : undefined,
            overflow: isPreview ? "auto" : undefined,
            overscrollBehavior: isPreview ? "contain" : undefined,
          }}
        >
          <div
            ref={contentRef}
            style={{
              color: error ? "var(--destructive)" : "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              opacity: 0.9,
            }}
          >
            {bodyText}
          </div>
        </div>
      )}
    </div>
  );
}


function toolDisplayMeta(toolName: string): { label: string; accent: string; bg: string; border: string } {
  const n = toolName.toLowerCase();
  if (n === "todo") {
    return {
      label: "todo",
      accent: "var(--accent)",
      bg: "color-mix(in oklab, var(--accent) 6%, var(--bg))",
      border: "color-mix(in oklab, var(--accent) 28%, var(--border))",
    };
  }
  if (n.includes("subagent") || n === "agent" || n.includes("delegate")) {
    return {
      label: toolName,
      accent: "var(--success)",
      bg: "color-mix(in oklab, var(--success) 7%, var(--bg))",
      border: "color-mix(in oklab, var(--success) 30%, var(--border))",
    };
  }
  if (n.includes("ask") || n.includes("question") || n.includes("user")) {
    return {
      label: toolName,
      accent: "var(--accent)",
      bg: "color-mix(in oklab, var(--accent) 5%, var(--bg))",
      border: "color-mix(in oklab, var(--accent) 25%, var(--border))",
    };
  }
  if (n.includes("simplif") || n.includes("review")) {
    return {
      label: toolName,
      accent: "var(--text)",
      bg: "var(--bg-panel)",
      border: "var(--border)",
    };
  }
  return {
    label: toolName,
    accent: "var(--success)",
    bg: "var(--success-bg)",
    border: "var(--success-border)",
  };
}

function parseEditFailureKind(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/Edit failed \(([^)]+)\)/i);
  return m?.[1] ?? null;
}

const ToolCallBlock = memo(function ToolCallBlock({
  block,
  result,
  duration,
  isStreaming,
  nested,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  isStreaming?: boolean;
  /** Rendered under a ToolRunGroup summary — slightly tighter indent chrome. */
  nested?: boolean;
}) {
  const { t } = useLocale();
  const isEditTool = isEditToolName(block.toolName);
  const isCard = isCardToolName(block.toolName);
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "" || resultText.trim() === "（无输出）");
  const isError = result?.isError ?? false;
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const pending = Boolean(isStreaming) && !result;

  // Hooks must run unconditionally (scaffold + card paths share them).
  // Scaffold: null = no user toggle yet → open on error, closed otherwise.
  const [scaffoldUserOpen, setScaffoldUserOpen] = useState<boolean | null>(null);
  const [cardExpanded, setCardExpanded] = useState(false);
  const scaffoldExpanded = scaffoldUserOpen ?? isError;
  const showScaffoldArgs = !isCard && scaffoldExpanded;
  const showCardArgs = isCard && cardExpanded && !isEditTool;
  const showInputArgs = showScaffoldArgs || showCardArgs;
  const inputStr = useMemo(
    () => (showInputArgs ? JSON.stringify(block.input, null, 2) : ""),
    [showInputArgs, block.input],
  );
  const editMeta = result && !result.isError && isEditTool ? getEditResultMeta(result) : null;
  const editFailureKind = isEditTool && isError ? parseEditFailureKind(resultText) : null;
  const meta = toolDisplayMeta(block.toolName);
  const longResult = (resultText?.length ?? 0) > 1200;
  const forceExpandError = isError && isEditTool;
  const showResultCollapsed = isCard && !cardExpanded && !forceExpandError && result && longResult && !resultDiff;

  // ── Hermes scaffold row for activity tools (read/bash/grep/…) ──────────
  // Default collapsed one-liner; expand for args/result. Cards (edit/write/ask)
  // keep the heavier bordered chrome below.
  if (!isCard) {
    const title = scaffoldToolTitle(block, pending, t);
    const hasBody = Boolean(result) || Object.keys(block.input ?? {}).length > 0;
    const expanded = scaffoldExpanded;

    return (
      <div
        data-slot="tool-row"
        data-tool-open={expanded ? "" : undefined}
        style={{
          color: isError ? "var(--destructive)" : "var(--text-muted)",
          fontSize: 12,
          lineHeight: 1.45,
          opacity: pending ? 0.9 : 0.82,
          paddingLeft: nested ? 14 : 0,
        }}
      >
        <button
          type="button"
          aria-expanded={hasBody ? expanded : undefined}
          onClick={() => {
            if (!hasBody) return;
            setScaffoldUserOpen(!expanded);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            minHeight: 22,
            padding: "1px 0",
            background: "none",
            border: "none",
            color: "inherit",
            cursor: hasBody ? "pointer" : "default",
            textAlign: "left",
            minWidth: 0,
          }}
        >
          {hasBody ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                flexShrink: 0,
                opacity: 0.55,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.15s ease",
              }}
            >
              <polyline points="3.5 2 6.5 5 3.5 8" />
            </svg>
          ) : (
            <span
              aria-hidden
              className={pending ? "tool-run-live" : undefined}
              style={{
                width: 6,
                height: 6,
                borderRadius: 2,
                background: "var(--text-dim)",
                flexShrink: 0,
                opacity: 0.65,
              }}
            />
          )}
          <span
            className={pending ? "tool-run-live" : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          {duration !== undefined && duration > 0 && !pending && (
            <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {formatThoughtDuration(duration)}
            </span>
          )}
        </button>
        {expanded && (
          <div style={{ marginTop: 4, marginLeft: 17, display: "flex", flexDirection: "column", gap: 6 }}>
            {showScaffoldArgs && inputStr && inputStr !== "{}" && (
              <pre
                style={{
                  margin: 0,
                  padding: "6px 8px",
                  color: "var(--text-muted)",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  overflow: "auto",
                  maxHeight: 160,
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {inputStr}
              </pre>
            )}
            {result && (
              resultDiff ? (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                  <PairedDiffResult diff={resultDiff} />
                </div>
              ) : (
                <div
                  style={{
                    border: isError ? "1px solid var(--destructive-border)" : "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    background: isError ? "var(--destructive-bg)" : "var(--bg-subtle)",
                  }}
                >
                  <PairedResult
                    text={resultText ?? ""}
                    isEmpty={resultIsEmpty}
                    isError={isError}
                  />
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Card tools (edit / write / ask) — keep full chrome + diffs ─────────
  const expanded = cardExpanded;

  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        fontSize: 12,
        border: isError ? "1px solid var(--destructive-border)" : `1px solid ${meta.border}`,
        background: isError ? "var(--destructive-bg)" : meta.bg,
      }}
    >
      <button
        onClick={() => setCardExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "7px 11px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: isError ? "var(--destructive)" : meta.accent, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {meta.label}
        </span>
        {editFailureKind && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--destructive)",
              border: "1px solid var(--destructive-border)",
              background: "var(--destructive-bg)",
              borderRadius: "var(--radius-xs)",
              padding: "1px 5px",
            }}
          >
            {editFailureKind}
          </span>
        )}
        {editMeta?.mode && !isError && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              letterSpacing: "0.03em",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              background: "var(--bg-subtle)",
              borderRadius: "var(--radius-xs)",
              padding: "1px 5px",
            }}
            title={editMeta.mode}
          >
            {editMeta.modeLabel}
          </span>
        )}
        {editMeta?.tag && !isError && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--success)",
              border: "1px solid var(--success-border)",
              background: "var(--success-bg)",
              borderRadius: "var(--radius-xs)",
              padding: "1px 5px",
            }}
            title="New hashline file tag after edit"
          >
            #{editMeta.tag}
          </span>
        )}
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {getToolPreview(block)}
        </span>
        {duration !== undefined && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
        {showResultCollapsed && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>…</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {showInputArgs && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12.5,
            lineHeight: 1.5,
            overflow: "auto",
            background: "var(--bg-subtle)",
            borderTop: isError ? "1px solid var(--destructive-border)" : `1px solid ${meta.border}`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {inputStr}
        </pre>
      )}

      {result && (expanded || forceExpandError || !longResult || resultDiff) && (
        resultDiff ? (
          <PairedDiffResult diff={resultDiff} />
        ) : (
          <PairedResult
            text={resultText ?? ""}
            isEmpty={resultIsEmpty}
            isError={isError}
          />
        )
      )}
      {showResultCollapsed && resultText && (
        <div
          style={{
            padding: "6px 11px 8px",
            borderTop: isError ? "1px solid var(--destructive-border)" : `1px solid ${meta.border}`,
            color: "var(--text-dim)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {resultText.replace(/\s+/g, " ").slice(0, 140)}…
        </div>
      )}
    </div>
  );
});

interface ResultDiff {
  text: string;
}

function PairedDiffResult({ diff }: {
  diff: ResultDiff;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--success-border)",
        background: "var(--bg)",
      }}
    >
      <SplitPatchView text={diff.text} />
    </div>
  );
}

const SplitPatchView = memo(function SplitPatchView({ text }: { text: string }) {
  const { t } = useLocale();
  const [showAllRows, setShowAllRows] = useState(false);
  // Big edits are capped so a transcript of long diffs cannot blow up the DOM;
  // the full patch is only parsed/rendered after an explicit click.
  const files = useMemo(
    () => parseUnifiedPatch(text, showAllRows ? undefined : { maxRows: MAX_DIFF_ROWS }),
    [text, showAllRows],
  );
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;
  const hiddenRows = files.reduce((sum, file) => sum + (file.hiddenRows ?? 0), 0);

  return (
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          {showFileHeaders && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--bg-panel)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <SplitDiffHeader title={file.oldPath || t("msg.diffBefore")} side="left" />
              <SplitDiffHeader title={file.newPath || t("msg.diffAfter")} side="right" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {hiddenRows > 0 && (
        <button
          type="button"
          onClick={() => setShowAllRows(true)}
          style={{
            display: "block",
            position: "sticky",
            bottom: 0,
            zIndex: 1,
            width: "100%",
            padding: "6px 10px",
            border: "none",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            textAlign: "left",
          }}
        >
          {t("msg.showMore")} (+{hiddenRows})
        </button>
      )}
    </div>
  );
});

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--text-dim)",
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

const SplitDiffCellView = memo(function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "var(--diff-add-bg)"
      : cell.type === "removed"
      ? "var(--diff-del-bg)"
      : cell.type === "empty"
      ? "var(--bg-subtle)"
      : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "var(--success)" : cell.type === "removed" ? "var(--destructive)" : "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: cell.type === "empty" ? "var(--text-dim)" : "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
});

function PatchTextView({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);

  return (
    <div style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.55, minWidth: 0 }}>
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bg =
          kind === "added" ? "var(--diff-add-bg)" :
          kind === "removed" ? "var(--diff-del-bg)" :
          kind === "hunk" ? "var(--diff-hunk-bg)" :
          "transparent";
        const color =
          kind === "added" ? "var(--success)" :
          kind === "removed" ? "var(--destructive)" :
          kind === "hunk" ? "var(--accent)" :
          "var(--text)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft: kind === "added"
                ? "3px solid var(--success)"
                : kind === "removed"
                ? "3px solid var(--destructive)"
                : kind === "hunk"
                ? "3px solid var(--accent)"
                : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ padding: "0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color }}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  // Nested hashline multi-result: concatenate per-file patches
  const results = details.results;
  if (Array.isArray(results)) {
    const parts: string[] = [];
    for (const row of results) {
      if (!isRecord(row)) continue;
      const p = typeof row.patch === "string" ? row.patch : typeof row.diff === "string" ? row.diff : null;
      if (p) parts.push(p);
    }
    if (parts.length > 0) return { text: parts.join("\n") };
  }

  return null;
}

function getEditResultMeta(result: ToolResultMessage): { mode?: string; modeLabel: string; tag?: string } | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) {
    // Fallback: parse "→ #ABCD" from result text
    const text = result.content
      ?.filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n") ?? "";
    const tagMatch = text.match(/→\s*#([0-9A-Fa-f]{4})\b/) ?? text.match(/#([0-9A-Fa-f]{4})\b/);
    if (!tagMatch) return null;
    return { modeLabel: "hashline", tag: tagMatch[1]!.toUpperCase() };
  }

  const mode = typeof details.mode === "string" ? details.mode : undefined;
  let tag = typeof details.tag === "string" ? details.tag.split(",")[0]?.trim() : undefined;
  if (!tag && Array.isArray(details.results) && details.results[0] && isRecord(details.results[0])) {
    const t = details.results[0].tag;
    if (typeof t === "string") tag = t;
  }
  if (tag) tag = tag.replace(/^#/, "").toUpperCase();

  const modeLabel =
    mode === "hashline-patch" ? "hashline"
      : mode === "hashline-hunks" ? "hunks"
        : mode === "classic-via-hashline" ? "strict"
          : mode === "classic-fuzzy" ? "classic"
            : mode ? mode.replace(/-/g, " ").slice(0, 16) : "edit";

  if (!mode && !tag) return null;
  return { mode, modeLabel, tag };
}

function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor");
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "var(--destructive-border)" : "var(--success-border)"}`,
        background: isError ? "var(--destructive-bg)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "var(--destructive)" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12.5,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
          background: "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? "—" : text}
      </pre>
    </div>
  );
}

function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useLocale();
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const time = formatTime(message.timestamp);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}>
            compaction
          </span>
          {time && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{time}</span>}
        </div>

        <div style={{ padding: "11px 13px 12px" }}>
          <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>
            {t("msg.conversationCompacted")}
          </div>
          <div style={{ marginTop: 3, marginBottom: 10, color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
            {t("msg.compactionSummaryIntro")}
          </div>
          {parsedSummary.body ? (
            <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
          ) : (
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("msg.noSummary")}</span>
          )}
          <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
        </div>
      </div>
    </div>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useLocale();
  const uniqueRead = Array.from(new Set(readFiles));
  const uniqueModified = Array.from(new Set(modifiedFiles));
  const total = uniqueRead.length + uniqueModified.length;
  if (total === 0) return null;

  const parts = [];
  if (uniqueRead.length > 0) parts.push(`${uniqueRead.length} ${t("msg.readFiles").toLowerCase()}`);
  if (uniqueModified.length > 0) parts.push(`${uniqueModified.length} ${t("msg.modifiedFiles").toLowerCase()}`);

  return (
    <details className="compaction-file-details">
      <summary>{t("msg.fileContext", { parts: parts.join(", ") })}</summary>
      {uniqueModified.length > 0 && <CompactionFileList title={t("msg.modifiedFiles")} files={uniqueModified} />}
      {uniqueRead.length > 0 && <CompactionFileList title={t("msg.readFiles")} files={uniqueRead} />}
    </details>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  // Compaction summaries can list the same path more than once — keep order,
  // drop exact duplicates so React keys stay unique.
  const uniqueFiles = Array.from(new Set(files));
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {uniqueFiles.map((file, index) => (
          <li key={`${index}:${file}`}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function CustomMessageView({ message, cwd, onOpenFile }: { message: CustomMessage; cwd?: string; onOpenFile?: (filePath: string) => void }) {
  const { t } = useLocale();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: isHiddenDisplay ? "var(--bg-subtle)" : "var(--bg)",
          opacity: isHiddenDisplay && !contentExpanded ? 0.82 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}>
            {title}
          </span>
          {isHiddenDisplay && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("msg.hiddenExtension")}</span>}
          {time && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{time}</span>}
        </div>

        {contentExpanded ? (
          <div style={{ padding: "6px 9px" }}>
            {images.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text ? 8 : 0 }}>
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    <PreviewableImage
                      key={i}
                      src={src}
                      alt=""
                      className="chat-sent-image"
                      previewLabel={t("msg.imagePreview")}
                    />
                  );
                })}
              </div>
            )}
            {text ? <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody> : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>(no message)</span>}
          </div>
        ) : (
          <button
            onClick={() => setContentExpanded(true)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
          >
            {text ? previewText(text) : t("msg.showExtensionMessage")}
          </button>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 9px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
          }}
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              style={{
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              style={{
                marginLeft: "auto",
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {isHiddenDisplay
                ? (contentExpanded ? t("msg.collapse") : t("msg.expand"))
                : (detailsExpanded ? t("msg.hideDetails") : t("msg.showDetails"))}
            </button>
          )}
        </div>

        {hasDetails && ((isHiddenDisplay && contentExpanded) || (!isHiddenDisplay && detailsExpanded)) && (
          <pre
            style={{
              margin: 0,
              padding: "9px 10px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflow: "auto",
              fontFamily: "var(--font-mono)",
            }}
          >
            {detailsText}
          </pre>
        )}
      </div>
    </div>
  );
}

function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

function BashExecutionView({ message, sessionId }: { message: BashExecutionMessage; sessionId?: string }) {
  const { t } = useLocale();
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const isPending = !message.output && message.exitCode === undefined && !message.cancelled;
  const isError = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputUrl = sessionId && message.fullOutputPath
    ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(message.fullOutputPath)}`
    : null;
  const showFullButton = message.truncated && fullOutputUrl && fullOutput === null;
  const displayOutput = fullOutput ?? message.output;

  async function loadFullOutput() {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const res = await fetch(fullOutputUrl);
      const d = await res.json() as { success?: boolean; data?: { output?: string }; error?: string };
      if (d.success) {
        setFullOutput(d.data?.output ?? "");
      } else {
        setFullError(d.error ?? "failed");
      }
    } catch (e) {
      setFullError(String(e));
    } finally {
      setLoadingFull(false);
    }
  }

  // Reuse the existing ToolCallBlock so user-run bash looks identical to an
  // agent-run bash tool call: same header, collapse behavior, result pane.
  // Synthesize an equivalent ToolCallContent + ToolResultMessage pair.
  const toolName = message.excludeFromContext ? t("msg.bashLocal") : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? ""}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending
    ? undefined
    : {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName,
        content: displayOutput ? [{ type: "text", text: displayOutput }] : [],
        isError,
        timestamp: message.timestamp,
      };

  return (
    <div style={{ margin: "6px 0" }}>
      <ToolCallBlock block={block} result={result} />
      {message.truncated && fullOutputUrl && (
        <div style={{ padding: "4px 10px", fontSize: 11, marginTop: -1 }}>
          {showFullButton && (
            <button
              onClick={loadFullOutput}
              disabled={loadingFull}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: loadingFull ? "default" : "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}
            >
              {loadingFull ? t("msg.loadingFull") : t("msg.viewFullOutput")}
            </button>
          )}
          <a
            href={`${fullOutputUrl}&download=1`}
            style={{ marginLeft: showFullButton ? 10 : 0, color: "var(--accent)", fontSize: 11, textDecoration: "underline" }}
          >
            {t("msg.downloadFullOutput")}
          </a>
          {fullError && <span style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 11 }}>({fullError})</span>}
        </div>
      )}
    </div>
  );
}
