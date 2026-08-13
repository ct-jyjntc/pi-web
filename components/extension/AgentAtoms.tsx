"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import type { AgentItem, AgentItemStatus } from "@/lib/extension-widget-agents";
import type { MessageKey } from "@/lib/i18n/messages";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";

const STATUS_KEY: Record<AgentItemStatus, MessageKey> = {
  running: "ext.agentRunning",
  queued: "ext.agentQueued",
  completed: "ext.agentCompleted",
  error: "ext.agentError",
  stopped: "ext.agentStopped",
  aborted: "ext.agentAborted",
  unknown: "ext.agentRunning",
};

function formatTokensK(tokens: number): string {
  const k = tokens / 1000;
  if (k >= 10) return `${Math.round(k)}k`;
  return `${Math.max(0, k).toFixed(1)}k`;
}

function formatElapsedMs(ms: number): string {
  const n = Math.max(0, ms);
  if (n < 1000) return `${Math.round(n)}ms`;
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** One subagent row — status on line 1; live tokens / % / elapsed on line 2. */
export function AgentItemRow({ item }: { item: AgentItem }) {
  const { t } = useLocale();
  const active = item.status === "running";
  const statusLabel = t(STATUS_KEY[item.status]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !item.startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, item.startedAt]);

  const elapsed = active && item.startedAt
    ? formatElapsedMs(now - item.startedAt)
    : item.elapsed;
  const stats = [
    item.tokens != null ? formatTokensK(item.tokens) : null,
    item.percent != null ? `${Math.round(item.percent)}%` : null,
    elapsed ?? null,
  ].filter(Boolean).join(" · ");
  const showSecond = Boolean(item.activity || stats);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "3px 6px",
        boxSizing: "border-box",
      }}
    >
      <Icon
        icon={Bot}
        size={12}
        strokeWidth={1.8}
        style={{ marginTop: 2, flexShrink: 0, color: active ? "var(--text)" : "var(--text-dim)" }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              lineHeight: 1.35,
              fontWeight: active ? 500 : 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.description}
          </div>
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              lineHeight: 1.35,
              color: "var(--text-dim)",
            }}
          >
            {statusLabel}
          </span>
        </div>
        {showSecond ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 1 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11,
                lineHeight: 1.3,
                color: "var(--text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.activity ?? ""}
            </div>
            {stats ? (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  lineHeight: 1.3,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-dim)",
                }}
              >
                {stats}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
