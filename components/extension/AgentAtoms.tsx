/**
 * Compact subagent catalog row: status dot, title + summary, tokens + elapsed.
 */
"use client";

import { useEffect, useState } from "react";
import type { AgentItem, AgentItemStatus } from "@/lib/extension-widget-agents";
import { requestChildTranscript } from "@/lib/child-transcript-store";
import { useLocale } from "@/hooks/useLocale";

function formatTokensK(tokens: number): string {
  const k = tokens / 1000;
  if (k >= 10) return `${Math.round(k)}K`;
  return `${Math.max(0, k).toFixed(1)}K`;
}

function elapsedMsFromItem(item: AgentItem, now: number): number | null {
  if (item.status === "running" && item.startedAt) {
    return Math.max(0, now - item.startedAt);
  }
  if (!item.elapsed) {
    if (item.startedAt) return Math.max(0, now - item.startedAt);
    return null;
  }
  const sec = /^(\d+(?:\.\d+)?)s$/i.exec(item.elapsed);
  if (sec) return Math.round(Number(sec[1]) * 1000);
  const ms = /^(\d+)ms$/i.exec(item.elapsed);
  if (ms) return Number(ms[1]);
  const clock = /^(\d+):(\d{2})$/.exec(item.elapsed);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  return null;
}

function formatElapsedLabel(
  ms: number,
  t: (key: "ext.agentElapsedSeconds" | "ext.agentElapsedMinutes", params: { n?: number; m?: number; s?: number }) => string,
): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return t("ext.agentElapsedSeconds", { n: sec });
  return t("ext.agentElapsedMinutes", { m: Math.floor(sec / 60), s: sec % 60 });
}

function dotColor(status: AgentItemStatus): string {
  if (status === "error" || status === "aborted" || status === "stopped") return "var(--destructive)";
  if (status === "queued") return "var(--text-dim)";
  return "var(--success)";
}

export function AgentItemRow({
  item,
  parentSessionId,
}: {
  item: AgentItem;
  parentSessionId?: string | null;
}) {
  const { t } = useLocale();
  const active = item.status === "running";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !item.startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, item.startedAt]);

  const title = item.description || item.type || "";
  const elapsedMs = elapsedMsFromItem(item, now);
  const tokens = item.tokens != null ? t("ext.agentTokens", { n: formatTokensK(item.tokens) }) : "";
  const duration = elapsedMs != null ? formatElapsedLabel(elapsedMs, t) : (item.elapsed ?? "");
  const summary = item.activity || (active ? t("ext.agentRunning") : t("ext.agentInactive"));
  const canOpen = Boolean(item.sessionId && parentSessionId);

  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? () => {
        requestChildTranscript({
          childSessionId: item.sessionId!,
          parentSessionId: parentSessionId!,
          title: item.description,
        });
      } : undefined}
      onKeyDown={canOpen ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        requestChildTranscript({
          childSessionId: item.sessionId!,
          parentSessionId: parentSessionId!,
          title: item.description,
        });
      } : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        boxSizing: "border-box",
        width: "100%",
        minHeight: 40,
        padding: "5px 8px",
        borderRadius: "var(--radius-sm)",
        cursor: canOpen ? "pointer" : "default",
      }}
    >
      <span
        aria-hidden
        className={active ? "tool-run-live" : undefined}
        style={{
          width: 6,
          height: 6,
          marginTop: 5,
          borderRadius: "var(--radius-pill)",
          background: dotColor(item.status),
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12,
            lineHeight: "16px",
            fontWeight: 400,
            color: "var(--text)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            lineHeight: "15px",
            color: "var(--text-muted)",
          }}
        >
          {summary}
        </div>
      </div>
      {(tokens || duration) ? (
        <div
          style={{
            display: "grid",
            gridTemplateRows: "16px 15px",
            flex: "none",
            textAlign: "right",
            fontSize: 11,
            lineHeight: "15px",
            fontVariantNumeric: "tabular-nums",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ gridRow: 1, lineHeight: "16px" }}>{tokens}</span>
          <span style={{ gridRow: 2 }}>{duration}</span>
        </div>
      ) : null}
    </div>
  );
}
