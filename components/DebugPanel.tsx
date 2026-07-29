"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

type DebugSession = {
  id: string;
  cwd: string;
  command: string;
  inspectUrl: string;
  pid: number | null;
  status: string;
  lastStop?: {
    reason?: string;
    callFrames?: Array<{
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    }>;
  };
};

type Frame = {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
};

export function DebugPanel({
  cwd,
  onOpenSource,
}: {
  cwd: string | null;
  /** Open a source location in the Files workspace (absolute path + 1-based line). */
  onOpenSource?: (filePath: string, line: number) => void;
}) {
  const { t } = useLocale();
  const [sessions, setSessions] = useState<DebugSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [logs, setLogs] = useState("");
  const [expr, setExpr] = useState("1+1");
  const [evalResult, setEvalResult] = useState<string | null>(null);
  const [command, setCommand] = useState("node -e \"let x=1; x=x+1; console.log(x)\"");
  const [bpFile, setBpFile] = useState("");
  const [bpLine, setBpLine] = useState("1");
  const [breakpoints, setBreakpoints] = useState<Array<{ id: string; file: string; line: number; bpId: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/debug/sessions");
      const data = await res.json() as { sessions?: DebugSession[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const list = data.sessions ?? [];
      setSessions(list);
      if (activeId && !list.some((s) => s.id === activeId)) {
        setActiveId(list[0]?.id ?? null);
      } else if (!activeId && list[0]) {
        setActiveId(list[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/debug/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        error?: string;
        session?: DebugSession;
        frames?: Frame[];
        logs?: string;
        value?: string;
        breakpointId?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.session) {
        setActiveId(data.session.id);
        if (data.session.lastStop?.callFrames) setFrames(data.session.lastStop.callFrames);
      }
      if (data.frames) setFrames(data.frames);
      if (typeof data.logs === "string") setLogs(data.logs);
      if (typeof data.value === "string") setEvalResult(data.value);
      await refresh();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId) {
      setFrames([]);
      setLogs("");
      return;
    }
    void (async () => {
      const stack = await act({ action: "stack", id: activeId });
      if (stack?.frames) setFrames(stack.frames);
      const logsRes = await act({ action: "logs", id: activeId });
      if (typeof logsRes?.logs === "string") setLogs(logsRes.logs);
    })();
    // only when switching session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const sectionLabel = (title: string) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-dim)",
        marginBottom: 6,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {title}
    </div>
  );

  return (
    <div
      className="git-panel debug-panel"
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
          <span className="git-panel-title-label">{t("debug.title")}</span>
          {active && (
            <span className="git-panel-stats" style={{ color: "var(--text-muted)" }}>
              {active.status}
            </span>
          )}
        </div>
        <div className="git-panel-toolbar-actions">
          <button
            type="button"
            className="chrome-btn is-icon"
            onClick={() => void refresh()}
            disabled={busy}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        <input
          className="input-base input-mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="node script.js"
          style={{ width: "100%" }}
          disabled={!cwd || busy}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={!cwd || busy || !command.trim()}
            onClick={() => void act({ action: "launch", cwd, command, breakOnStart: true })}
          >
            {t("debug.launch")}
          </button>
        </div>
        {!cwd && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("debug.needCwd")}</div>
        )}
      </div>

      {error && (
        <div className="git-panel-notice is-error">{error}</div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 160, borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0 }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>{t("debug.empty")}</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`debug-session-row${s.id === activeId ? " is-active" : ""}`}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{s.status}</div>
              </button>
            ))
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {active ? (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                <div><strong style={{ color: "var(--text)", fontWeight: 600 }}>{t("debug.status")}:</strong> {active.status}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 4, wordBreak: "break-all" }}>{active.command}</div>
                {active.pid != null && <div style={{ marginTop: 4 }}>pid {active.pid}</div>}
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void act({ action: "continue", id: active.id })}>{t("debug.continue")}</button>
                <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void act({ action: "pause", id: active.id })}>{t("debug.pause")}</button>
                <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void act({ action: "stack", id: active.id }).then((d) => d?.frames && setFrames(d.frames))}>{t("debug.stack")}</button>
                <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void act({ action: "logs", id: active.id }).then((d) => typeof d?.logs === "string" && setLogs(d.logs))}>{t("debug.logs")}</button>
                <button type="button" className="btn-danger btn-compact" disabled={busy} onClick={() => {
                  void act({ action: "stop", id: active.id }).then(() => {
                    setBreakpoints((prev) => prev.filter((b) => b.id !== active.id));
                    setFrames([]);
                    setLogs("");
                    setEvalResult(null);
                  });
                }}>{t("debug.stop")}</button>
              </div>

              <div>
                {sectionLabel(t("debug.breakpoint"))}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    className="input-base input-mono"
                    value={bpFile}
                    onChange={(e) => setBpFile(e.target.value)}
                    placeholder={t("debug.bpFilePlaceholder")}
                    style={{ flex: "1 1 140px", minWidth: 120, height: 26 }}
                  />
                  <input
                    className="input-base input-mono"
                    value={bpLine}
                    onChange={(e) => setBpLine(e.target.value)}
                    placeholder="line"
                    style={{ width: 64, height: 26 }}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    disabled={busy || !bpFile.trim() || !Number(bpLine)}
                    onClick={() => {
                      const line = Number(bpLine);
                      const file = bpFile.trim();
                      void act({ action: "breakpoint", id: active.id, file, line }).then((d) => {
                        if (!d) return;
                        const bpId = typeof d.breakpointId === "string" ? d.breakpointId : `${file}:${line}`;
                        setBreakpoints((prev) => [
                          ...prev.filter((b) => !(b.id === active.id && b.file === file && b.line === line)),
                          { id: active.id, file, line, bpId },
                        ]);
                        setNotice(t("debug.bpSet", { file, line }));
                      });
                    }}
                  >
                    {t("debug.setBreakpoint")}
                  </button>
                </div>
                {breakpoints.filter((b) => b.id === active.id).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                    {breakpoints.filter((b) => b.id === active.id).map((b) => (
                      <div
                        key={`${b.file}:${b.line}:${b.bpId}`}
                        className="debug-frame"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {b.file}:{b.line}
                        <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>{b.bpId}</span>
                      </div>
                    ))}
                  </div>
                )}
                {notice && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--success)" }}>{notice}</div>
                )}
              </div>

              <div>
                {sectionLabel(t("debug.stack"))}
                {frames.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("debug.noFrames")}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {frames.map((f, i) => {
                      const localPath = frameUrlToPath(f.url, active?.cwd ?? cwd);
                      const clickable = Boolean(localPath && onOpenSource && f.lineNumber > 0);
                      const body = (
                        <>
                          {i}: {f.functionName}{" "}
                          <span style={{ color: "var(--text-dim)" }}>
                            {localPath ? `${localPath}:${f.lineNumber}` : `${f.url}:${f.lineNumber}`}
                          </span>
                        </>
                      );
                      return clickable ? (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onOpenSource?.(localPath!, f.lineNumber)}
                          title={t("debug.openFrame")}
                          className="debug-frame debug-frame-link"
                        >
                          {body}
                        </button>
                      ) : (
                        <div key={i} className="debug-frame">
                          {body}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                {sectionLabel(t("debug.evaluate"))}
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="input-base input-mono" value={expr} onChange={(e) => setExpr(e.target.value)} style={{ flex: 1, height: 26 }} />
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    disabled={busy || !expr.trim()}
                    onClick={() => void act({ action: "evaluate", id: active.id, expression: expr }).then((d) => typeof d?.value === "string" && setEvalResult(d.value))}
                  >
                    {t("debug.run")}
                  </button>
                </div>
                {evalResult != null && (
                  <pre style={{ margin: "6px 0 0", fontSize: 11, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--bg-subtle)", padding: "6px 8px", borderRadius: "var(--radius-sm)" }}>{evalResult}</pre>
                )}
              </div>

              <div>
                {sectionLabel(t("debug.logs"))}
                <pre style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 160, overflow: "auto", background: "var(--bg-subtle)", padding: "6px 8px", borderRadius: "var(--radius-sm)" }}>{logs || "—"}</pre>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("debug.selectOrLaunch")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Map CDP/file URL to a local absolute path when possible. */
function frameUrlToPath(url: string, baseCwd: string | null | undefined): string | null {
  if (!url) return null;
  try {
    if (url.startsWith("file://")) {
      const u = new URL(url);
      let p = decodeURIComponent(u.pathname);
      // Windows file URLs may look like /C:/...
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p;
    }
  } catch {
    // fall through
  }
  // bare path
  if (url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url)) return url;
  // relative to session cwd
  if (baseCwd && !url.includes("://")) {
    const joined = `${baseCwd.replace(/\/$/, "")}/${url.replace(/^\.\//, "")}`;
    return joined;
  }
  return null;
}
