"use client";

import { memo, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Icon } from "../../Icon";
import { useLocale } from "@/hooks/useLocale";
import { formatThoughtDuration } from "@/lib/message-display";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import {
  liveRunLine,
  settledRunLine,
  type BlockItem,
} from "../tool-run-meta";
import { ToolCallBlock } from "./ToolCallBlock";

export const ToolRunGroup = memo(function ToolRunGroup({ items, toolResults, toolCallDurations, isStreaming, sessionId }: {
  items: BlockItem[];
  toolResults?: Map<string, ToolResultMessage>;
  toolCallDurations?: Map<string, number>;
  isStreaming?: boolean;
  sessionId?: string;
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
        sessionId={sessionId}
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
  // Errors stay folded by default — the red "N errors" badge marks the row.
  const expanded = open ?? live;

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
          <Icon
            icon={ChevronRight}
            size={10}
            strokeWidth={1.6}
            style={{
              flexShrink: 0,
              opacity: 0.55,
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          />
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
          {items.map((item) => {
            const tc = item.block as ToolCallContent;
            return (
              <ToolCallBlock
                key={item.originalIndex}
                block={tc}
                result={toolResults?.get(tc.toolCallId)}
                duration={toolCallDurations?.get(tc.toolCallId)}
                isStreaming={isStreaming && !toolResults?.get(tc.toolCallId)}
                sessionId={sessionId}
                nested
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
