"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlignLeft, Check, Copy, FileText, Square } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import { copyText } from "@/lib/clipboard";
import { useSessionMetrics } from "@/lib/session-metrics-store";
import { getCompactHandlers, requestCompact, subscribeCompactHandlers } from "@/lib/compact-action-store";
import type { ExtensionStatusItem } from "@/lib/types";
import { Icon } from "./Icon";

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

export function ContextPanel() {
  const { t } = useLocale();
  const { contextUsage, sessionStats, extensionStatuses } = useSessionMetrics();
  const compactState = useSyncExternalStore(
    subscribeCompactHandlers,
    getCompactHandlers,
    () => null,
  );
  const [checkpoints, setCheckpoints] = useState<Array<{
    id: string;
    name: string;
    summary: string;
    entryId?: string;
    createdAt: string;
  }>>([]);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabUrl, setCollabUrl] = useState<string | null>(null);

  useEffect(() => {
    const sid = sessionStats?.sessionId;
    if (!sid) {
      setCheckpoints([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/checkpoints?sessionId=${encodeURIComponent(sid)}`)
      .then(async (res) => {
        const data = await res.json() as { checkpoints?: typeof checkpoints };
        if (!cancelled && Array.isArray(data.checkpoints)) setCheckpoints(data.checkpoints);
      })
      .catch(() => {
        if (!cancelled) setCheckpoints([]);
      });
    return () => { cancelled = true; };
  }, [sessionStats?.sessionId]);

  const shareCollab = useCallback(async () => {
    const sid = sessionStats?.sessionId;
    if (!sid) return;
    setCollabBusy(true);
    try {
      const res = await fetch("/api/collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          sessionFile: sessionStats.sessionFile,
          note: sessionStats.sessionName || "",
        }),
      });
      const data = await res.json() as {
        error?: string;
        share?: { token?: string };
      };
      if (!res.ok || data.error || !data.share?.token) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const url = `${window.location.origin}/collab/${data.share.token}`;
      setCollabUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // ignore clipboard failures
      }
    } catch {
      setCollabUrl(null);
    } finally {
      setCollabBusy(false);
    }
  }, [sessionStats?.sessionFile, sessionStats?.sessionId, sessionStats?.sessionName]);

  const rewindTo = useCallback(async (entryId: string | undefined) => {
    const sid = sessionStats?.sessionId;
    if (!sid || !entryId) return;
    setCheckpointBusy(true);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "navigate_tree", entryId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // Soft reload so the chat tree reflects the navigated leaf.
      window.location.reload();
    } catch {
      // ignore — user can still switch branch manually
    } finally {
      setCheckpointBusy(false);
    }
  }, [sessionStats?.sessionId]);

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
      <div className="git-panel-toolbar">
        <div className="git-panel-title">
          <span className="git-panel-title-label">{t("shell.contextTab")}</span>
          {ctxPct != null && (
            <span className="git-panel-stats" style={{ color: ctxColor }}>
              {`${Math.round(ctxPct)}%`}
            </span>
          )}
          {c > 0 && (
            <span className="git-panel-stats" style={{ color: "var(--text-muted)" }}>
              {`$${c.toFixed(2)}`}
            </span>
          )}
        </div>
        <div className="git-panel-toolbar-actions">
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
            >
              {compactState.isCompacting ? (
                <>
                  <Icon icon={Square} size={10} fill="currentColor" strokeWidth={0} />
                  <span>{t("chat.compacting")}</span>
                </>
              ) : (
                <>
                  <Icon icon={AlignLeft} size={12} strokeWidth={1.8} />
                  <span>{t("chat.compact")}</span>
                </>
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
            >
              {copiedSessionField === "file" ? (
                <Icon icon={Check} size={13} strokeWidth={2} />
              ) : (
                <Icon icon={FileText} size={13} strokeWidth={1.8} />
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
            >
              {copiedSessionField === "id" ? (
                <Icon icon={Check} size={13} strokeWidth={2} />
              ) : (
                <Icon icon={Copy} size={13} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      </div>

      {compactState?.error && (
        <div
          role="alert"
          style={{
            margin: "8px 12px 0",
            padding: "7px 10px",
            border: "1px solid var(--destructive-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--destructive-bg)",
            color: "var(--destructive)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            flexShrink: 0,
          }}
        >
          {compactState.error}
        </div>
      )}
      {compactState?.resultText && !compactState.error && (
        <div
          style={{
            margin: "8px 12px 0",
            padding: "7px 10px",
            border: "1px solid var(--success-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--success-bg)",
            color: "var(--success)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.45,
            flexShrink: 0,
          }}
        >
          {compactState.resultText}
        </div>
      )}

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

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "8px 12px",
                    borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
                  }}
                >
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    disabled={collabBusy}
                    onClick={() => void shareCollab()}
                    style={{ alignSelf: "flex-start" }}
                  >
                    {collabBusy ? t("common.loading") : t("collab.share")}
                  </button>
                  {collabUrl && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all", fontFamily: "var(--font-mono)" }}>
                      {t("collab.linkCopied")}:{" "}
                      <a href={collabUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        {collabUrl}
                      </a>
                    </div>
                  )}
                </div>

                {sectionHeader(t("shell.messages"))}
                {kvRow(t("shell.user"), sessionStats.userMessages.toLocaleString())}
                {kvRow(t("shell.assistant"), sessionStats.assistantMessages.toLocaleString())}
                {kvRow(t("shell.toolCalls"), sessionStats.toolCalls.toLocaleString())}
                {kvRow(t("shell.toolResults"), sessionStats.toolResults.toLocaleString())}
                {kvRow(t("shell.total"), sessionStats.totalMessages.toLocaleString())}

                {sectionHeader(t("shell.checkpoints"))}
                {checkpoints.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-dim)",
                      padding: "8px 12px",
                      borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
                    }}
                  >
                    {t("shell.checkpointsEmpty")}
                  </div>
                ) : (
                  <div>
                    {checkpoints.slice(0, 8).map((cp) => (
                      <div
                        key={cp.id}
                        className="context-panel-row"
                        style={{
                          padding: "6px 12px",
                          borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24 }}>
                          <strong style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cp.name}</strong>
                          <span style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                            {cp.id}
                          </span>
                          {cp.entryId && (
                            <span className="git-file-actions" style={{ marginLeft: "auto" }}>
                              <button
                                type="button"
                                className="chrome-btn"
                                disabled={checkpointBusy}
                                onClick={() => void rewindTo(cp.entryId)}
                              >
                                {t("shell.checkpointRewind")}
                              </button>
                            </span>
                          )}
                        </div>
                        {cp.summary && (
                          <div style={{ color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                            {cp.summary}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
