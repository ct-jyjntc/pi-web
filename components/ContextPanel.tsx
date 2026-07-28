"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "@/hooks/useLocale";
import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import { copyText } from "@/lib/clipboard";
import { useSessionMetrics } from "@/lib/session-metrics-store";
import { getCompactHandlers, requestCompact, subscribeCompactHandlers } from "@/lib/compact-action-store";
import type { ExtensionStatusItem } from "@/lib/types";

function isPermissionStatus(status: { key: string; text: string }): boolean {
  const k = status.key.toLowerCase();
  const t = status.text.toLowerCase();
  // Permission mode is already controlled in the composer toolbar.
  return (
    k.includes("permission")
    || k.includes("pi-permission")
    || k.includes("yolo")
    || t === "yolo"
    || t.includes("yolo mode")
    || t.includes("permission")
  );
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function visibleExtensionStatuses(statuses: ExtensionStatusItem[]): ExtensionStatusItem[] {
  return [...statuses]
    .filter((status) => !isPermissionStatus(status))
    .map((status) => ({
      key: status.key,
      text: sanitizeStatusText(status.text),
    }))
    .filter((status) => status.text.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

type SessionCopyField = "file" | "id";

export function ContextTabBadge() {
  const { contextUsage } = useSessionMetrics();
  const pct = contextUsage?.percent;
  if (pct == null) return null;
  return (
    <span
      className="right-workspace-tab-count"
      style={{
        fontSize: 10,
        fontVariantNumeric: "tabular-nums",
        color: pct > 90 ? "var(--destructive)" : "var(--text-dim)",
        background: "var(--bg-subtle)",
        borderRadius: "var(--radius-pill)",
        padding: "0 6px",
        minWidth: 16,
        textAlign: "center",
        lineHeight: "16px",
        flexShrink: 0,
      }}
    >
      {`${Math.round(pct)}%`}
    </span>
  );
}

export function ContextPanel() {
  const { t } = useLocale();
  const { contextUsage, sessionStats, extensionStatuses } = useSessionMetrics();
  const compactState = useSyncExternalStore(
    subscribeCompactHandlers,
    getCompactHandlers,
    () => null,
  );
  const extensionRows = useMemo(
    () => visibleExtensionStatuses(extensionStatuses),
    [extensionStatuses],
  );
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  const tokens = sessionStats?.tokens;
  const c = sessionStats?.cost ?? 0;
  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;
  let ctxColor = "var(--text-muted)";
  let ctxPct: number | null = null;
  if (ctx?.contextWindow) {
    ctxPct = ctx.percent;
    if (ctxPct !== null && ctxPct > 90) ctxColor = "var(--destructive)";
    else if (ctxPct !== null && ctxPct > 70) ctxColor = "var(--text)";
  }

  const sectionHeader = (title: string) => (
    <div
      className="context-panel-section"
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 28,
        padding: "0 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-dim)",
        flexShrink: 0,
      }}
    >
      {title}
    </div>
  );

  const kvRow = (label: string, value: string, mono = false) => (
    <div
      key={`${label}:${value}`}
      className="context-panel-row"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        minHeight: 32,
        padding: "6px 12px",
        borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0, lineHeight: "20px" }}>{label}</span>
      <span style={{
        marginLeft: "auto",
        color: "var(--text-muted)",
        textAlign: "right",
        minWidth: 0,
        overflowWrap: "anywhere",
        wordBreak: mono ? "break-all" : "normal",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        fontVariantNumeric: "tabular-nums",
        lineHeight: "20px",
      }}>{value}</span>
    </div>
  );

  const usageRows: string[][] = [];
  if (ctx?.contextWindow) {
    usageRows.push([t("shell.context"), ctxPct !== null ? `${ctxPct.toFixed(1)}%` : t("shell.statUnknown")]);
    usageRows.push([t("shell.statTokens"), ctx.tokens != null ? `${fmt(ctx.tokens)} / ${fmt(ctx.contextWindow)}` : fmt(ctx.contextWindow)]);
  }
  if (tokens) {
    if (tokens.input > 0) usageRows.push([t("shell.input"), tokens.input.toLocaleString()]);
    if (tokens.output > 0) usageRows.push([t("shell.output"), tokens.output.toLocaleString()]);
    if (tokens.cacheRead > 0) usageRows.push([t("shell.cacheRead"), tokens.cacheRead.toLocaleString()]);
    if (tokens.cacheWrite > 0) usageRows.push([t("shell.cacheWrite"), tokens.cacheWrite.toLocaleString()]);
    if (tokens.total > 0) usageRows.push([t("shell.total"), tokens.total.toLocaleString()]);
  }
  if (c > 0) usageRows.push([t("shell.cost"), `$${c.toFixed(4)}`]);

  return (
    <div
      className="git-panel context-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        flex: 1,
        background: "var(--bg)",
      }}
    >
      <div
        className="git-panel-toolbar"
        style={{
          display: "flex",
          alignItems: "stretch",
          minHeight: 36,
          height: 36,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <div
          className="git-panel-title"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: "100%",
            padding: "0 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            minWidth: 0,
            flex: 1,
          }}
        >
          <span>{t("shell.contextTab")}</span>
          {ctxPct != null && (
            <span
              className="git-panel-stats"
              style={{
                fontSize: 11,
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                color: ctxColor,
              }}
            >
              {`${Math.round(ctxPct)}%`}
            </span>
          )}
          {c > 0 && (
            <span
              className="git-panel-stats"
              style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
            >
              {`$${c.toFixed(2)}`}
            </span>
          )}
        </div>
        <div className="git-panel-toolbar-actions" style={{ display: "flex", alignItems: "stretch", marginLeft: "auto", flexShrink: 0 }}>
          {compactState && (
            <button
              type="button"
              className={`chrome-btn${compactState.isCompacting ? " is-danger is-active" : ""}`}
              onClick={() => {
                if (compactState.isCompacting) {
                  compactState.abort?.();
                  return;
                }
                requestCompact();
              }}
              title={compactState.isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
              aria-label={compactState.isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
              style={{
                height: "100%",
                minHeight: 0,
                borderRadius: 0,
                borderLeft: "1px solid var(--border)",
                padding: "0 12px",
                gap: 6,
                fontSize: 12,
              }}
            >
              {compactState.isCompacting ? (
                <>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" />
                  </svg>
                  <span>{t("chat.compacting")}</span>
                </>
              ) : (
                <span>{t("chat.compact")}</span>
              )}
            </button>
          )}
          {sessionStats?.sessionFile && (
            <button
              type="button"
              className="chrome-btn is-icon"
              onClick={() => handleCopySessionField("file", sessionStats.sessionFile!)}
              title={copiedSessionField === "file" ? t("common.copied") : t("shell.copyFilePath")}
              aria-label={t("shell.copyFilePath")}
              style={{ height: "100%", minHeight: 0, width: 36, minWidth: 36, borderLeft: "1px solid var(--border)", borderRadius: 0 }}
            >
              {copiedSessionField === "file" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
              )}
            </button>
          )}
          {sessionStats && (
            <button
              type="button"
              className="chrome-btn is-icon"
              onClick={() => handleCopySessionField("id", sessionStats.sessionId)}
              title={copiedSessionField === "id" ? t("common.copied") : t("shell.copySessionId")}
              aria-label={t("shell.copySessionId")}
              style={{ height: "100%", minHeight: 0, width: 36, minWidth: 36, borderLeft: "1px solid var(--border)", borderRadius: 0 }}
            >
              {copiedSessionField === "id" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {ctx?.contextWindow && (
        <div
          className="git-panel-subheader"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 32,
            height: 32,
            padding: "0 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            flexShrink: 0,
          }}
        >
          <div
            aria-hidden
            style={{
              flex: 1,
              height: 4,
              borderRadius: "var(--radius-pill)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <div style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, ctxPct ?? 0))}%`,
              background: ctxColor === "var(--destructive)" ? "var(--destructive)" : "var(--accent)",
              opacity: 0.85,
            }} />
          </div>
          <span style={{
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: ctxColor,
            flexShrink: 0,
            fontFamily: "var(--font-mono)",
          }}>
            {ctx.tokens != null
              ? `${fmt(ctx.tokens)} / ${fmt(ctx.contextWindow)}`
              : (ctxPct !== null ? `${ctxPct.toFixed(0)}%` : fmt(ctx.contextWindow))}
          </span>
        </div>
      )}

      <div className="git-panel-body" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {!sessionStats && !ctx?.contextWindow && extensionRows.length === 0 ? (
          <div style={{
            padding: "24px 12px",
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: 12,
          }}>
            {t("shell.sessionInfoEmpty")}
          </div>
        ) : (
          <>
            {usageRows.length > 0 && (
              <>
                {sectionHeader(t("shell.contextUsage"))}
                {usageRows.map(([label, value]) => kvRow(label, value))}
              </>
            )}

            {extensionRows.length > 0 && (
              <>
                {sectionHeader(t("shell.extensionStatus"))}
                {extensionRows.map((status) => {
                  const plain = stripAnsi(status.text);
                  const segments = parseAnsiLine(status.text);
                  return (
                    <div
                      key={status.key}
                      className="context-panel-row"
                      title={`${status.key}: ${plain}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        minHeight: 32,
                        padding: "6px 12px",
                        borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          color: "var(--text-muted)",
                          flexShrink: 0,
                          width: 88,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          lineHeight: "20px",
                        }}
                      >
                        {status.key}
                      </span>
                      <span
                        style={{
                          color: "var(--text)",
                          minWidth: 0,
                          flex: 1,
                          overflowWrap: "anywhere",
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          lineHeight: "18px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {segments.length > 0
                          ? segments.map((segment, index) => (
                            <span key={index} style={segment.style}>{segment.text}</span>
                          ))
                          : plain}
                      </span>
                    </div>
                  );
                })}
              </>
            )}

            {sessionStats && (
              <>
                {sectionHeader(t("shell.sessionInfoTitle"))}
                {sessionStats.sessionName && kvRow(t("shell.name"), sessionStats.sessionName)}
                {kvRow(t("shell.file"), sessionStats.sessionFile ?? t("shell.inMemory"), true)}
                {kvRow(t("shell.id"), sessionStats.sessionId, true)}

                {sectionHeader(t("shell.messages"))}
                {kvRow(t("shell.user"), sessionStats.userMessages.toLocaleString())}
                {kvRow(t("shell.assistant"), sessionStats.assistantMessages.toLocaleString())}
                {kvRow(t("shell.toolCalls"), sessionStats.toolCalls.toLocaleString())}
                {kvRow(t("shell.toolResults"), sessionStats.toolResults.toLocaleString())}
                {kvRow(t("shell.total"), sessionStats.totalMessages.toLocaleString())}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
