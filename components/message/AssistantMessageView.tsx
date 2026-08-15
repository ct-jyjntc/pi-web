"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, ChevronRight, Copy } from "lucide-react";
import { Icon } from "../Icon";
import { ReviewSummaryCard } from "../ReviewSummaryCard";
import { copyText } from "@/lib/clipboard";
import { useLocale } from "@/hooks/useLocale";
import { getAssistantErrorMessage, isEmptyThinkingBlock } from "@/lib/message-display";
import { parseReviewReport } from "@/lib/review-report";
import type {
  AssistantMessage,
  TextContent,
  ToolResultMessage,
} from "@/lib/types";
import {
  estimateStreamTokens,
  formatTime,
  formatUsage,
  slidingWindowTps,
  type StreamTpsSample,
} from "./message-view-utils";
import { MessageHoverShell } from "./MessageHoverShell";
import { BlockView } from "./blocks/BlockView";
import { ToolRunGroup } from "./blocks/ToolRunGroup";
import { groupRunBlocks } from "./tool-run-meta";
import { turnWrittenFiles } from "@/lib/turn-written-files";
import { getFileName } from "@/lib/file-paths";

export function AssistantMessageView({
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
  const [errorOpen, setErrorOpen] = useState(false);
  const tpsSamplesRef = useRef<StreamTpsSample[]>([]);
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
  const estTokens = useMemo(() => (isStreaming ? estimateStreamTokens(blocks) : 0), [isStreaming, blocks]);
  const estTokensRef = useRef(estTokens);
  estTokensRef.current = estTokens;

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
      tpsSamplesRef.current = [];
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

      const tokens = estTokensRef.current;
      if (tokens === 0) return;
      const next = slidingWindowTps(tpsSamplesRef.current, now, tokens);
      if (next === null) return;
      // Only re-render when the displayed (one decimal) value actually moves.
      setTps((prev) => (prev !== null && Math.round(prev * 10) === Math.round(next * 10) ? prev : next));
    };
    tick();
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
                <Icon icon={Check} size={11} strokeWidth={1.8} />
              ) : (
                <Icon icon={Copy} size={11} strokeWidth={1.8} />
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
                <Icon icon={ArrowDown} size={10} strokeWidth={1.2} />
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
              // Keyed by first block index, never by possibly-empty toolCallId.
              key={`${entryId ?? "stream"}-run-${item.items[0]!.originalIndex}`}
              items={item.items}
              toolResults={toolResults}
              toolCallDurations={toolCallDurations}
              isStreaming={isStreaming}
              sessionId={sessionId}
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
        {!isStreaming && !isProcess && onOpenFile && turnWrittenFiles(message, toolResults).map((path) => (
          <button
            key={path}
            type="button"
            className="chrome-btn"
            onClick={() => onOpenFile(path)}
            style={{ marginTop: 8, marginRight: 6, fontSize: 11, fontFamily: "var(--font-mono)" }}
          >
            {getFileName(path)}
          </button>
        ))}
      </div>

      {providerError && !isProcess && (
        <div
          role="alert"
          style={{
            marginTop: blocks.length > 0 ? 8 : 0,
            color: "var(--destructive)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <button
            type="button"
            aria-expanded={errorOpen}
            onClick={() => setErrorOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              width: "100%",
              minHeight: 22,
              padding: 0,
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
              minWidth: 0,
              fontSize: "inherit",
              fontFamily: "inherit",
            }}
          >
            <Icon
              icon={ChevronRight}
              size={10}
              strokeWidth={1.6}
              style={{
                flexShrink: 0,
                opacity: 0.55,
                transform: errorOpen ? "rotate(90deg)" : "none",
                transition: "transform 0.15s ease",
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
            >
              Error: {providerError}
            </span>
          </button>
          {errorOpen && (
            <div
              style={{
                marginTop: 4,
                marginLeft: 17,
                padding: "6px 8px",
                border: "1px solid var(--destructive-border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--destructive-bg)",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {providerError}
            </div>
          )}
        </div>
      )}
    </MessageHoverShell>
  );
}
