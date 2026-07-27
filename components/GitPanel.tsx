"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import { useLocale } from "@/hooks/useLocale";
import type { MessageKey } from "@/lib/i18n/messages";
import { getFileName } from "@/lib/file-paths";
import { DiffView } from "./FileViewer";

interface Props {
  cwd: string | null;
  refreshKey?: number;
  onOpenFile?: (filePath: string, fileName: string) => void;
  onStatusChange?: (status: GitStatusResponse | null) => void;
  /** Focus/expand this path when provided (e.g. opened from file tree). */
  focusPath?: string | null;
  /** Embed as collapsible strip (legacy). Default is full-page review. */
  embedded?: boolean;
  defaultExpanded?: boolean;
}

const STATUS_KEYS: Record<GitFileStatusKind, MessageKey> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "var(--text)",
  added: "var(--success)",
  deleted: "var(--destructive)",
  renamed: "var(--text-muted)",
  untracked: "var(--text-dim)",
  conflict: "var(--destructive)",
};

async function fetchStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  const data = await res.json() as GitStatusResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return {
    ...data,
    ahead: data.ahead ?? 0,
    behind: data.behind ?? 0,
    upstream: data.upstream ?? null,
    conflictCount: data.conflictCount ?? 0,
    stagedCount: data.stagedCount ?? 0,
    unstagedCount: data.unstagedCount ?? 0,
    insertions: data.insertions ?? 0,
    deletions: data.deletions ?? 0,
    branch: data.branch ?? null,
    files: (data.files ?? []).map((f) => ({
      ...f,
      staged: f.staged ?? false,
      unstaged: f.unstaged ?? true,
      insertions: f.insertions ?? 0,
      deletions: f.deletions ?? 0,
    })),
  };
}

function relPath(filePath: string, root: string | null): string {
  if (!root) return filePath;
  const prefix = root.endsWith("/") || root.endsWith("\\") ? root : `${root}/`;
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
  return getFileName(filePath);
}

export function GitPanel({
  cwd,
  refreshKey = 0,
  onOpenFile,
  onStatusChange,
  focusPath = null,
  embedded = false,
  defaultExpanded = true,
}: Props) {
  const { t } = useLocale();
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [commitOpen, setCommitOpen] = useState(false);
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [generating, setGenerating] = useState(false);
  /** Paths with inline diff expanded (Codex-style). Default: all when body shown. */
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(new Set());
  const [diffsInitialized, setDiffsInitialized] = useState(false);
  const branchRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      onStatusChange?.(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchStatus(cwd);
      setStatus(next);
      onStatusChange?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
      onStatusChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [cwd, onStatusChange]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Default: expand all file diffs when status first loads (Codex-style)
  useEffect(() => {
    if (!status?.isGitRepository || diffsInitialized) return;
    setOpenDiffs(new Set(status.files.map((f) => f.filePath)));
    setDiffsInitialized(true);
    setExpanded(true);
  }, [status, diffsInitialized]);

  useEffect(() => {
    setDiffsInitialized(false);
    setOpenDiffs(new Set());
  }, [cwd]);

  // Focus path from file tree → expand that row
  useEffect(() => {
    if (!focusPath) return;
    setExpanded(true);
    setOpenDiffs((prev) => new Set(prev).add(focusPath));
  }, [focusPath]);

  useEffect(() => {
    if (!branchOpen && !commitOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (branchOpen && branchRef.current && !branchRef.current.contains(target)) {
        setBranchOpen(false);
      }
      if (commitOpen && commitRef.current && !commitRef.current.contains(target)) {
        setCommitOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [branchOpen, commitOpen]);

  const conflicts = useMemo(() => (status?.files ?? []).filter((f) => f.status === "conflict"), [status]);
  const staged = useMemo(() => (status?.files ?? []).filter((f) => f.staged && f.status !== "conflict"), [status]);
  const unstaged = useMemo(() => (status?.files ?? []).filter((f) => f.unstaged && f.status !== "conflict"), [status]);
  const allFiles = useMemo(() => {
    // Codex-like flat list: conflicts first, then rest by path
    const rest = (status?.files ?? []).filter((f) => f.status !== "conflict");
    return [...conflicts, ...rest];
  }, [conflicts, status]);

  const mutate = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (!cwd) return null;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        status?: GitStatusResponse;
        commit?: string | null;
        message?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status) {
        setStatus(data.status);
        onStatusChange?.(data.status);
      } else {
        await load();
      }
      if (data.commit) {
        setMessage("");
        setNotice(t("git.commitSuccess", { hash: data.commit }));
      } else if (data.message && (path.includes("push") || path.includes("pull"))) {
        setNotice(data.message.split("\n")[0] ?? data.message);
      }
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [cwd, load, onStatusChange, t]);

  const stagePaths = useCallback((paths: string[]) => void mutate("/api/git/stage", { cwd, paths }), [cwd, mutate]);
  const unstagePaths = useCallback((paths: string[]) => void mutate("/api/git/unstage", { cwd, paths }), [cwd, mutate]);
  const discardPaths = useCallback((paths: string[], key: MessageKey) => {
    if (!window.confirm(t(key))) return;
    void mutate("/api/git/discard", { cwd, paths });
  }, [cwd, mutate, t]);

  const requestCommitMessage = useCallback(async (
    mode: "ai" | "heuristic",
    opts?: { fill?: boolean },
  ): Promise<string | null> => {
    if (!cwd) return null;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/git/commit-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          mode,
          includeUnstaged,
        }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.message) {
        if (opts?.fill !== false) setMessage(data.message);
        return data.message;
      }
      return null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setGenerating(false);
    }
  }, [cwd, includeUnstaged]);

  /** Explicit Generate button → AI only. */
  const generateMessage = useCallback(async () => {
    await requestCommitMessage("ai", { fill: true });
  }, [requestCommitMessage]);

  const runCommit = useCallback(async (alsoPush: boolean) => {
    if (!cwd) return;
    // Optionally stage unstaged first
    if (includeUnstaged && unstaged.length > 0) {
      const stagedOk = await mutate("/api/git/stage", {
        cwd,
        paths: unstaged.map((f) => f.filePath),
      });
      if (!stagedOk) return;
    }
    let msg = message.trim();
    if (!msg) {
      // Empty box keeps the fast filename/stat draft — AI is opt-in via Generate.
      msg = (await requestCommitMessage("heuristic", { fill: false }))?.trim() ?? "";
      if (!msg) return;
    }
    const committed = await mutate("/api/git/commit", { cwd, message: msg });
    if (!committed) return;
    setMessage("");
    setCommitOpen(false);
    if (alsoPush) {
      await mutate("/api/git/push", { cwd });
    }
  }, [cwd, includeUnstaged, message, mutate, requestCommitMessage, unstaged]);

  const pushOnly = useCallback(async () => {
    await mutate("/api/git/push", { cwd });
    setCommitOpen(false);
  }, [cwd, mutate]);

  const openBranches = useCallback(async () => {
    if (!cwd) return;
    setCommitOpen(false);
    setBranchOpen((v) => !v);
    if (branchOpen) return;
    try {
      const params = new URLSearchParams({ cwd });
      const res = await fetch(`/api/git/branches?${params.toString()}`);
      const data = await res.json() as { branches?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBranches(data.branches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [branchOpen, cwd]);

  const switchBranch = useCallback(async (branch: string) => {
    setBranchOpen(false);
    await mutate("/api/git/branches", { cwd, action: "checkout", branch });
  }, [cwd, mutate]);

  const createBranch = useCallback(async () => {
    const name = newBranch.trim();
    if (!name) return;
    setBranchOpen(false);
    setNewBranch("");
    await mutate("/api/git/branches", { cwd, action: "create", branch: name });
  }, [cwd, mutate, newBranch]);

  if (embedded) {
    if (!cwd) return null;
    if (!loading && status && !status.isGitRepository) return null;
  } else {
    if (!cwd) return <div style={emptyStyle}>{t("git.noCwd")}</div>;
    if (loading && !status) return <div style={emptyStyle}>{t("git.loading")}</div>;
    if (status && !status.isGitRepository) return <div style={emptyStyle}>{t("git.notRepo")}</div>;
  }

  const changeCount = (status?.stagedCount ?? 0) + (status?.unstagedCount ?? 0) + (status?.conflictCount ?? 0);
  // Full review page always shows the list; only legacy embedded strip can collapse.
  const showBody = !embedded || expanded;
  const insertions = status?.insertions ?? 0;
  const deletions = status?.deletions ?? 0;

  return (
    <div className="git-panel" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, flex: 1, background: "var(--bg)" }}>
      {/* Header strip — changes stats + collapse/refresh/commit */}
      <div
        className="git-panel-toolbar"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 0,
          minHeight: 36,
          height: 36,
          padding: 0,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <div
          className="git-panel-title"
          style={{
            display: "inline-flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: "100%",
            padding: "0 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          {t("git.changes")}
          {(insertions > 0 || deletions > 0) && (
            <span className="git-panel-stats" style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: "tabular-nums", display: "inline-flex", gap: 4 }}>
              {insertions > 0 && <span style={{ color: "var(--success)" }}>{t("git.linesAdded", { n: insertions })}</span>}
              {deletions > 0 && <span style={{ color: "var(--destructive)" }}>{t("git.linesDeleted", { n: deletions })}</span>}
            </span>
          )}
          {changeCount > 0 && insertions === 0 && deletions === 0 && (
            <span className="git-panel-stats" style={{ fontSize: 11, fontWeight: 500, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{changeCount}</span>
          )}
        </div>

        <div
          className="git-panel-toolbar-actions"
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            marginLeft: "auto",
            flexShrink: 0,
            height: "100%",
          }}
        >
        <button
          type="button"
          className="chrome-btn is-icon"
          title={openDiffs.size > 0 ? t("git.collapseAll") : t("git.expandAll")}
          aria-label={openDiffs.size > 0 ? t("git.collapseAll") : t("git.expandAll")}
          onClick={() => {
            if (openDiffs.size > 0) {
              setOpenDiffs(new Set());
            } else {
              setExpanded(true);
              setOpenDiffs(new Set((status?.files ?? []).map((f) => f.filePath)));
            }
          }}
          style={{ height: "100%", minHeight: 0, width: 36, minWidth: 36, borderLeft: "1px solid var(--border)", borderRadius: 0 }}
        >
          {openDiffs.size > 0 ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" /><line x1="12" y1="5" x2="12" y2="19" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="chrome-btn is-icon"
          onClick={() => void load()}
          disabled={busy || loading}
          title={t("git.refresh")}
          style={{ height: "100%", minHeight: 0, width: 36, minWidth: 36, borderLeft: "1px solid var(--border)", borderRadius: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>

        <div ref={commitRef} style={{ position: "relative", flexShrink: 0, display: "flex", flexDirection: "row", height: "100%" }}>
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={busy}
            onClick={() => {
              setBranchOpen(false);
              setCommitOpen((v) => !v);
            }}
            style={{ gap: 6, padding: "0 12px", borderRadius: 0, height: "100%", minHeight: 0, borderLeft: "1px solid var(--border)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6" />
            </svg>
            {t("git.commitOrPush")}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
              <polyline points="2 3.5 5 6.5 8 3.5" />
            </svg>
          </button>

          {commitOpen && (
            <div
              className="menu-card"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                width: 300,
                zIndex: 80,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ opacity: 0.6, flexShrink: 0 }}>
                    <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {status?.branch ?? "—"}
                  </span>
                </div>
                {((status?.insertions ?? 0) > 0 || (status?.deletions ?? 0) > 0) && (
                  <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", display: "inline-flex", gap: 4, flexShrink: 0 }}>
                    {(status?.insertions ?? 0) > 0 && <span style={{ color: "var(--success)" }}>+{status?.insertions ?? 0}</span>}
                    {(status?.deletions ?? 0) > 0 && <span style={{ color: "var(--destructive)" }}>-{status?.deletions ?? 0}</span>}
                  </span>
                )}
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("git.messageOptional")}
                rows={3}
                disabled={busy || generating}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  resize: "vertical",
                  minHeight: 64,
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: 13,
                  lineHeight: 1.45,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.35 }}>
                  {t("git.generateHint")}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || generating || (staged.length === 0 && !(includeUnstaged && unstaged.length > 0))}
                  onClick={() => void generateMessage()}
                  style={{ height: 28, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
                >
                  {generating ? t("git.generating") : t("git.generateMessage")}
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={includeUnstaged}
                  onChange={(e) => setIncludeUnstaged(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                />
                {t("git.includeUnstaged")}
              </label>

              <button
                type="button"
                className="chrome-btn"
                disabled={busy || generating || (staged.length === 0 && !(includeUnstaged && unstaged.length > 0))}
                onClick={() => void runCommit(false)}
                style={{ width: "100%", height: 34, justifyContent: "space-between", padding: "0 12px", background: "var(--bg-selected)" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6" /></svg>
                  {busy ? t("git.committing") : t("git.commit")}
                </span>
              </button>
              <button
                type="button"
                className="chrome-btn"
                disabled={busy || generating || (staged.length === 0 && !(includeUnstaged && unstaged.length > 0) && (status?.ahead ?? 0) === 0)}
                onClick={() => void runCommit(true)}
                style={{ width: "100%", height: 34, justifyContent: "flex-start", padding: "0 12px", gap: 8 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
                </svg>
                {t("git.commitAndPush")}
              </button>
              <button
                type="button"
                className="chrome-btn"
                disabled={busy}
                onClick={() => void pushOnly()}
                style={{ width: "100%", height: 34, justifyContent: "flex-start", padding: "0 12px", gap: 8 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
                </svg>
                {t("git.push")}
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Subheader: branch → upstream */}
      {showBody && (
        <div
          className="git-panel-subheader"
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            minHeight: 32,
            height: 32,
            padding: 0,
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            flexShrink: 0,
          }}
        >
          <div
            className="git-panel-branch"
            ref={branchRef}
            style={{ position: "relative", display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flex: 1, padding: "0 4px 0 0" }}
          >
            <button
              type="button"
              className="chrome-btn"
              onClick={() => void openBranches()}
              disabled={busy}
              style={{ padding: "0 10px", gap: 6, fontFamily: "var(--font-mono)", fontSize: 12, borderLeft: "none", height: "100%", minHeight: 0 }}
            >
              {status?.branch ?? "—"}
              {status?.upstream && (
                <span style={{ color: "var(--text-dim)" }}>→ {status.upstream}</span>
              )}
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ opacity: 0.5, display: "block", flexShrink: 0 }}>
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
            {branchOpen && (
              <div className="menu-card" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 220, zIndex: 70, maxHeight: 260, overflow: "auto" }}>
                {branches.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`sidebar-menu-item${b === status?.branch ? " sidebar-menu-item-active" : ""}`}
                    onClick={() => void switchBranch(b)}
                    disabled={busy || b === status?.branch}
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {b === status?.branch ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                    ) : <span style={{ width: 10 }} />}
                    {b}
                  </button>
                ))}
                <div style={{ borderTop: "1px solid var(--border)", padding: 8 }}>
                  <input
                    className="input-base input-mono"
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    placeholder={t("git.branchName")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createBranch();
                      if (e.key === "Escape") setBranchOpen(false);
                    }}
                    style={{ marginBottom: 6 }}
                  />
                  <button type="button" className="btn-primary btn-compact" style={{ width: "100%" }} disabled={busy || !newBranch.trim()} onClick={() => void createBranch()}>
                    {t("git.createBranch")}
                  </button>
                </div>
              </div>
            )}
            {(status?.ahead ?? 0) > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{t("git.ahead", { n: status!.ahead })}</span>
            )}
            {(status?.behind ?? 0) > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{t("git.behind", { n: status!.behind })}</span>
            )}
          </div>
          <button
            type="button"
            className="chrome-btn"
            disabled={busy}
            onClick={() => void mutate("/api/git/pull", { cwd })}
            style={{ padding: "0 12px", fontSize: 11, height: "100%", minHeight: 0, borderLeft: "1px solid var(--border)", borderRadius: 0, flexShrink: 0 }}
          >
            {t("git.pull")}
          </button>
        </div>
      )}

      {showBody && (error || notice) && (
        <div className={`git-panel-notice ${error ? "is-error" : "is-ok"}`}>
          {error ? `${t("git.error")}: ${error}` : notice}
        </div>
      )}

      {showBody && (
        <div className="git-panel-body" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {allFiles.length === 0 ? (
            <div style={{ ...emptyStyle, height: 80 }}>{t("git.clean")}</div>
          ) : (
            allFiles.map((file) => (
              <FileRow
                key={file.filePath}
                file={file}
                root={status?.repositoryRoot ?? null}
                cwd={cwd}
                busy={busy}
                t={t}
                expanded={openDiffs.has(file.filePath)}
                onToggleExpand={() => {
                  setOpenDiffs((prev) => {
                    const next = new Set(prev);
                    if (next.has(file.filePath)) next.delete(file.filePath);
                    else next.add(file.filePath);
                    return next;
                  });
                }}
                onStage={() => stagePaths([file.filePath])}
                onUnstage={() => unstagePaths([file.filePath])}
                onDiscard={() => discardPaths([file.filePath], "git.discardConfirm")}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const emptyStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-dim)",
  fontSize: 12,
  padding: 16,
  textAlign: "center",
};

function FileRow({
  file,
  root,
  cwd,
  busy,
  t,
  expanded,
  onToggleExpand,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFileStatus;
  root: string | null;
  cwd: string | null;
  busy: boolean;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  expanded: boolean;
  onToggleExpand: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const name = relPath(file.filePath, root);
  const color = STATUS_COLORS[file.status];
  const isConflict = file.status === "conflict";

  useEffect(() => {
    if (!expanded || !cwd || file.status === "deleted") {
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    const params = new URLSearchParams({ cwd, path: file.filePath });
    fetch(`/api/git/diff?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json() as { supported?: boolean; patch?: string; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (data.supported && data.patch) setPatch(data.patch);
        else {
          setPatch(null);
          setDiffError(t("git.noDiff"));
        }
      })
      .catch((e) => {
        if (!cancelled) setDiffError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd, expanded, file.filePath, file.status, t]);

  return (
    <div className="git-file-row" style={{ borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)" }}>
      <div
        className={`git-file-header${expanded ? " is-open" : ""}${isConflict ? " is-conflict" : ""}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onToggleExpand}
        title={file.filePath}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 32,
          padding: "4px 10px",
          cursor: "pointer",
          background: isConflict
            ? "color-mix(in oklab, var(--destructive) 6%, transparent)"
            : hovered || expanded ? "var(--bg-hover)" : "transparent",
        }}
      >
        <svg
          className={`git-file-chevron${expanded ? " is-open" : ""}`}
          width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6"
          style={{
            flexShrink: 0,
            opacity: 0.55,
            display: "block",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.12s ease",
          }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
        <span
          className="git-file-code"
          style={{
            color,
            width: 14,
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
            textAlign: "center",
          }}
        >
          {file.code}
        </span>
        <span
          className="git-file-name"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            whiteSpace: "normal",
            lineHeight: 1.35,
          }}
        >
          {name}
        </span>

        {(file.insertions > 0 || file.deletions > 0) && (
          <span className="git-file-stat" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", display: "inline-flex", gap: 4, flexShrink: 0 }}>
            {file.insertions > 0 && <span style={{ color: "var(--success)" }}>+{file.insertions}</span>}
            {file.deletions > 0 && <span style={{ color: "var(--destructive)" }}>-{file.deletions}</span>}
          </span>
        )}

        {hovered && (
          <div className="git-file-actions" onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {file.unstaged && file.status !== "conflict" && (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onDiscard}
                style={{ color: "var(--destructive)", height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}>
                {t("git.discard")}
              </button>
            )}
            {file.staged ? (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onUnstage}
                style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}>
                {t("git.unstage")}
              </button>
            ) : (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onStage}
                style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}>
                {t("git.stage")}
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        file.status === "deleted" ? (
          <div style={{ padding: "6px 14px 10px 32px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {t("files.deleted")}
          </div>
        ) : diffLoading ? (
          <div style={{ padding: "6px 14px 10px 32px", fontSize: 12, color: "var(--text-dim)" }}>{t("git.loadingDiff")}</div>
        ) : diffError ? (
          <div style={{ padding: "6px 14px 10px 32px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{diffError}</div>
        ) : patch ? (
          <DiffView patch={patch} />
        ) : (
          <div style={{ padding: "6px 14px 10px 32px", fontSize: 12, color: "var(--text-dim)" }}>{t("git.noDiff")}</div>
        )
      )}
    </div>
  );
}
