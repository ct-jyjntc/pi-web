"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import { useLocale } from "@/hooks/useLocale";
import type { MessageKey } from "@/lib/i18n/messages";
import { getFileName } from "@/lib/file-paths";
import { DiffView } from "./DiffView";

interface Props {
  cwd: string | null;
  refreshKey?: number;
  onStatusChange?: (status: GitStatusResponse | null) => void;
  /** Start a Git Review chat session (prompt already sent server-side). */
  onReviewSessionStarted?: (session: {
    id: string;
    cwd: string;
    name?: string;
  }) => void;
  /** Focus/expand this path when provided (e.g. opened from file tree). */
  focusPath?: string | null;
}

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
  onStatusChange,
  onReviewSessionStarted,
  focusPath = null,
}: Props) {
  const { t } = useLocale();
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPlanning, setSplitPlanning] = useState(false);
  const [splitExecuting, setSplitExecuting] = useState(false);
  const [splitGroups, setSplitGroups] = useState<Array<{
    id: string;
    title: string;
    message: string;
    paths: string[];
    rationale?: string;
  }>>([]);
  const [splitUnassigned, setSplitUnassigned] = useState<string[]>([]);
  const [splitSource, setSplitSource] = useState<"ai" | "heuristic" | null>(null);
  const [merging, setMerging] = useState(false);
  const [completingMerge, setCompletingMerge] = useState(false);
  /** Paths with inline diff expanded (Codex-style). Default: all when body shown. */
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(new Set());
  const [diffsInitialized, setDiffsInitialized] = useState(false);
  const [linkedPr, setLinkedPr] = useState<{
    number: number;
    title: string;
    url: string;
    state?: string;
  } | null>(null);
  const [linkedPrLoading, setLinkedPrLoading] = useState(false);
  const [prDiffOpen, setPrDiffOpen] = useState(false);
  const [prDiffText, setPrDiffText] = useState<string | null>(null);
  const [prDiffBusy, setPrDiffBusy] = useState(false);
  const [prDiffError, setPrDiffError] = useState<string | null>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      onStatusChange?.(null);
      setMerging(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchStatus(cwd);
      setStatus(next);
      onStatusChange?.(next);
      try {
        const mres = await fetch(`/api/git/merge?cwd=${encodeURIComponent(cwd)}`);
        const mdata = await mres.json() as { merging?: boolean };
        setMerging(Boolean(mdata.merging));
      } catch {
        setMerging(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
      onStatusChange?.(null);
      setMerging(false);
    } finally {
      setLoading(false);
    }
  }, [cwd, onStatusChange]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Linked PR for current branch (gh CLI; silent if unavailable)
  useEffect(() => {
    if (!cwd || !status?.isGitRepository || !status.branch) {
      setLinkedPr(null);
      return;
    }
    let cancelled = false;
    setLinkedPrLoading(true);
    void (async () => {
      try {
        // Prefer view for current branch
        const res = await fetch("/api/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "list_prs", limit: 20, state: "open" }),
        });
        const data = await res.json() as {
          ok?: boolean;
          details?: Array<{
            number?: number;
            title?: string;
            url?: string;
            headRefName?: string;
            state?: string;
          }>;
        };
        if (cancelled) return;
        const branch = status.branch;
        const match = Array.isArray(data.details)
          ? data.details.find((p) => p.headRefName === branch)
          : null;
        if (match?.number && match.title && match.url) {
          setLinkedPr({
            number: match.number,
            title: match.title,
            url: match.url,
            state: match.state,
          });
        } else {
          setLinkedPr(null);
        }
      } catch {
        if (!cancelled) setLinkedPr(null);
      } finally {
        if (!cancelled) setLinkedPrLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, status?.isGitRepository, status?.branch, refreshKey]);

  // Reset PR diff when branch / PR changes
  useEffect(() => {
    setPrDiffOpen(false);
    setPrDiffText(null);
    setPrDiffError(null);
  }, [cwd, status?.branch, linkedPr?.number]);

  // Default: expand all file diffs when status first loads (Codex-style)
  useEffect(() => {
    if (!status?.isGitRepository || diffsInitialized) return;
    setOpenDiffs(new Set(status.files.map((f) => f.filePath)));
    setDiffsInitialized(true);
  }, [status, diffsInitialized]);

  useEffect(() => {
    setDiffsInitialized(false);
    setOpenDiffs(new Set());
  }, [cwd]);

  // Focus path from file tree → expand that row
  useEffect(() => {
    if (!focusPath) return;
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

  const stagePaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    void mutate("/api/git/stage", { cwd, paths });
  }, [cwd, mutate]);
  const unstagePaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    void mutate("/api/git/unstage", { cwd, paths });
  }, [cwd, mutate]);
  const discardPaths = useCallback((paths: string[], key: MessageKey) => {
    if (paths.length === 0) return;
    if (!window.confirm(t(key))) return;
    void mutate("/api/git/discard", { cwd, paths });
  }, [cwd, mutate, t]);

  const stageAll = useCallback(() => {
    stagePaths(unstaged.map((f) => f.filePath));
  }, [stagePaths, unstaged]);

  const discardAll = useCallback(() => {
    // Match confirm copy: discard unstaged working-tree changes (tracked + untracked).
    discardPaths(unstaged.map((f) => f.filePath), "git.discardAllConfirm");
  }, [discardPaths, unstaged]);

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

  const startReview = useCallback(async () => {
    if (!cwd || reviewing) return;
    setReviewing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, includeUnstaged: true }),
      });
      const data = await res.json() as {
        error?: string;
        prompt?: string;
        sessionName?: string;
        suggestedModel?: { provider: string; modelId: string } | null;
      };
      if (!res.ok || data.error || !data.prompt) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const { getFullToolNames } = await import("@/lib/tool-presets");
      const createRes = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          type: "prompt",
          message: data.prompt,
          toolNames: getFullToolNames(),
          ...(data.suggestedModel
            ? { provider: data.suggestedModel.provider, modelId: data.suggestedModel.modelId }
            : {}),
        }),
      });
      const created = await createRes.json() as { error?: string; sessionId?: string };
      if (!createRes.ok || created.error || !created.sessionId) {
        throw new Error(created.error ?? `HTTP ${createRes.status}`);
      }

      // Best-effort session rename for sidebar clarity.
      if (data.sessionName) {
        try {
          await fetch(`/api/sessions/${encodeURIComponent(created.sessionId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: data.sessionName }),
          });
        } catch {
          // ignore rename failures
        }
      }

      onReviewSessionStarted?.({
        id: created.sessionId,
        cwd,
        name: data.sessionName,
      });
      setNotice(t("git.reviewStarted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }, [cwd, onReviewSessionStarted, reviewing, t]);

  const completeMerge = useCallback(async () => {
    if (!cwd || completingMerge) return;
    setCompletingMerge(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        commit?: string | null;
        status?: GitStatusResponse;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status) {
        setStatus(data.status);
        onStatusChange?.(data.status);
      } else {
        await load();
      }
      setMerging(false);
      setNotice(t("git.mergeCompleted", { hash: data.commit ?? "?" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompletingMerge(false);
    }
  }, [completingMerge, cwd, load, onStatusChange, t]);

  const resolveConflict = useCallback(async (
    filePath: string,
    action: "ours" | "theirs" | "base" | "ai",
  ) => {
    if (!cwd) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, path: filePath, action }),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        status?: GitStatusResponse;
        explanation?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status) {
        setStatus(data.status);
        onStatusChange?.(data.status);
      } else {
        await load();
      }
      setNotice(data.explanation ?? t("git.resolved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [cwd, load, onStatusChange, t]);

  const planSplit = useCallback(async () => {
    if (!cwd) return;
    setSplitPlanning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/commit-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          mode: "plan",
          includeUnstaged,
        }),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        groups?: Array<{ id: string; title: string; message: string; paths: string[]; rationale?: string }>;
        unassigned?: string[];
        source?: "ai" | "heuristic";
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSplitGroups(data.groups ?? []);
      setSplitUnassigned(data.unassigned ?? []);
      setSplitSource(data.source ?? null);
      setSplitOpen(true);
      setCommitOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSplitPlanning(false);
    }
  }, [cwd, includeUnstaged]);

  const executeSplit = useCallback(async () => {
    if (!cwd || splitGroups.length === 0) return;
    setSplitExecuting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/git/commit-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          mode: "execute",
          groups: splitGroups.map((g) => ({ message: g.message, paths: g.paths })),
        }),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        commits?: Array<{ commit: string | null }>;
        status?: GitStatusResponse;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status) {
        setStatus(data.status);
        onStatusChange?.(data.status);
      } else {
        await load();
      }
      setNotice(t("git.splitDone", { n: data.commits?.length ?? splitGroups.length }));
      setSplitOpen(false);
      setSplitGroups([]);
      setSplitUnassigned([]);
      setSplitSource(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setSplitExecuting(false);
    }
  }, [cwd, load, onStatusChange, splitGroups, t]);

  const runCommit = useCallback(async (alsoPush: boolean) => {
    if (!cwd) return;
    if ((status?.conflictCount ?? 0) > 0) {
      setError(t("git.conflictHint"));
      return;
    }
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
  }, [cwd, includeUnstaged, message, mutate, requestCommitMessage, status?.conflictCount, t, unstaged]);

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

  if (!cwd) return <div style={emptyStyle}>{t("git.noCwd")}</div>;
  if (loading && !status) return <div style={emptyStyle}>{t("git.loading")}</div>;
  if (status && !status.isGitRepository) return <div style={emptyStyle}>{t("git.notRepo")}</div>;

  const changeCount = (status?.stagedCount ?? 0) + (status?.unstagedCount ?? 0) + (status?.conflictCount ?? 0);
  const insertions = status?.insertions ?? 0;
  const deletions = status?.deletions ?? 0;

  return (
    <div className="git-panel" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, flex: 1, background: "var(--bg)" }}>
      {/* Header strip — changes stats + collapse/refresh/commit (icon-only when narrow) */}
      <div className="git-panel-toolbar">
        <div className="git-panel-title">
          <span className="git-panel-title-label">{t("git.changes")}</span>
          {(insertions > 0 || deletions > 0) && (
            <span className="git-panel-stats">
              {insertions > 0 && <span style={{ color: "var(--success)" }}>{t("git.linesAdded", { n: insertions })}</span>}
              {deletions > 0 && <span style={{ color: "var(--destructive)" }}>{t("git.linesDeleted", { n: deletions })}</span>}
            </span>
          )}
          {changeCount > 0 && insertions === 0 && deletions === 0 && (
            <span className="git-panel-stats" style={{ color: "var(--text-dim)" }}>{changeCount}</span>
          )}
        </div>

        <div className="git-panel-toolbar-actions">
        <button
          type="button"
          className="chrome-btn"
          disabled={busy || reviewing || (status?.files.length ?? 0) === 0}
          onClick={() => void startReview()}
          title={reviewing ? t("git.reviewRunning") : t("git.review")}
          aria-label={reviewing ? t("git.reviewRunning") : t("git.review")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span>{reviewing ? t("git.reviewRunning") : t("git.review")}</span>
        </button>
        <button
          type="button"
          className="chrome-btn"
          disabled={busy || unstaged.length === 0}
          onClick={stageAll}
          title={t("git.stageAll")}
          aria-label={t("git.stageAll")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
          </svg>
          <span>{t("git.stageAll")}</span>
        </button>
        <button
          type="button"
          className="chrome-btn is-danger"
          disabled={busy || unstaged.length === 0}
          onClick={discardAll}
          title={t("git.discardAll")}
          aria-label={t("git.discardAll")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />
          </svg>
          <span>{t("git.discardAll")}</span>
        </button>
        <button
          type="button"
          className="chrome-btn is-icon"
          title={openDiffs.size > 0 ? t("git.collapseAll") : t("git.expandAll")}
          aria-label={openDiffs.size > 0 ? t("git.collapseAll") : t("git.expandAll")}
          onClick={() => {
            if (openDiffs.size > 0) {
              setOpenDiffs(new Set());
            } else {
              setOpenDiffs(new Set((status?.files ?? []).map((f) => f.filePath)));
            }
          }}
        >
          {openDiffs.size > 0 ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
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
          aria-label={t("git.refresh")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>

        <div ref={commitRef} style={{ position: "relative", flexShrink: 0, display: "flex", flexDirection: "row", height: "100%" }}>
          <button
            type="button"
            className="btn-primary btn-compact git-panel-commit-btn"
            disabled={busy}
            title={t("git.commitOrPush")}
            aria-label={t("git.commitOrPush")}
            aria-expanded={commitOpen}
            onClick={() => {
              setBranchOpen(false);
              setCommitOpen((v) => !v);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6" />
            </svg>
            <span className="git-panel-commit-label">{t("git.commitOrPush")}</span>
            <svg className="git-panel-commit-chevron" width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <polyline points="2 3.5 5 6.5 8 3.5" />
            </svg>
          </button>

          {commitOpen && (
            <div
              className="menu-card git-panel-commit-menu"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                width: 300,
                zIndex: 90,
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
                disabled={
                  busy
                  || splitPlanning
                  || conflicts.length > 0
                  || (staged.length === 0 && !(includeUnstaged && unstaged.length > 0))
                }
                onClick={() => void planSplit()}
                style={{ width: "100%", height: 34, justifyContent: "flex-start", padding: "0 12px", gap: 8 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8" /><path d="m9 12 3-3 3 3" /><path d="M21 3l-7 7" /><path d="M3 3l7 7" />
                </svg>
                {splitPlanning ? t("git.splitRunning") : t("git.splitCommits")}
              </button>

              <button
                type="button"
                className="chrome-btn"
                disabled={busy || generating || conflicts.length > 0 || (staged.length === 0 && !(includeUnstaged && unstaged.length > 0))}
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
                disabled={busy || generating || conflicts.length > 0 || (staged.length === 0 && !(includeUnstaged && unstaged.length > 0) && (status?.ahead ?? 0) === 0)}
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

      {/* Subheader: branch → upstream (collapses when narrow) */}
      {(
        <div className="git-panel-subheader">
          <div className="git-panel-branch" ref={branchRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="chrome-btn git-panel-branch-btn"
              onClick={() => void openBranches()}
              disabled={busy}
              title={status?.upstream ? `${status?.branch ?? "—"} → ${status.upstream}` : (status?.branch ?? "—")}
              aria-label={t("git.branch")}
              aria-expanded={branchOpen}
            >
              <span className="git-panel-branch-name">{status?.branch ?? "—"}</span>
              {status?.upstream && (
                <span className="git-panel-branch-upstream">→ {status.upstream}</span>
              )}
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ opacity: 0.5, display: "block", flexShrink: 0 }} aria-hidden>
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
              <span className="git-panel-branch-meta" style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{t("git.ahead", { n: status!.ahead })}</span>
            )}
            {(status?.behind ?? 0) > 0 && (
              <span className="git-panel-branch-meta" style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{t("git.behind", { n: status!.behind })}</span>
            )}
            {linkedPr && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" }}>
                <a
                  href={linkedPr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="git-panel-branch-meta"
                  title={`${linkedPr.title}\n${linkedPr.url}`}
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--accent)",
                    textDecoration: "none",
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("git.linkedPr", { n: linkedPr.number })} · {linkedPr.title}
                </a>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  disabled={prDiffBusy}
                  title={t("git.prDiff")}
                  onClick={() => {
                    if (prDiffOpen) {
                      setPrDiffOpen(false);
                      return;
                    }
                    setPrDiffOpen(true);
                    if (prDiffText) return;
                    setPrDiffBusy(true);
                    setPrDiffError(null);
                    void fetch("/api/github", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cwd, action: "diff", number: linkedPr.number }),
                    })
                      .then(async (res) => {
                        const data = await res.json() as { ok?: boolean; text?: string; error?: string };
                        if (!res.ok || data.ok === false) throw new Error(data.error ?? data.text ?? `HTTP ${res.status}`);
                        setPrDiffText(data.text ?? "(empty diff)");
                      })
                      .catch((e) => setPrDiffError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setPrDiffBusy(false));
                  }}
                  style={{ height: 22, minHeight: 22, padding: "0 6px", fontSize: 10, flexShrink: 0 }}
                >
                  {prDiffBusy ? "…" : prDiffOpen ? t("git.prDiffHide") : t("git.prDiff")}
                </button>
              </div>
            )}
            {!linkedPr && linkedPrLoading && (
              <span className="git-panel-branch-meta" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {t("git.linkedPrLoading")}
              </span>
            )}
          </div>
          <button
            type="button"
            className="chrome-btn git-panel-pull-btn"
            disabled={busy}
            onClick={() => void mutate("/api/git/pull", { cwd })}
            title={t("git.pull")}
            aria-label={t("git.pull")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
            </svg>
            <span>{t("git.pull")}</span>
          </button>
        </div>
      )}

      {prDiffOpen && linkedPr && (
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-panel)",
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
              {t("git.prDiffTitle", { n: linkedPr.number })}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              pr://{linkedPr.number}/diff
            </span>
            <button
              type="button"
              className="btn-ghost btn-compact"
              style={{ marginLeft: "auto", height: 22, minHeight: 22, padding: "0 6px", fontSize: 10 }}
              onClick={() => setPrDiffOpen(false)}
            >
              {t("git.prDiffHide")}
            </button>
          </div>
          {prDiffError && (
            <div style={{ padding: 10, fontSize: 12, color: "var(--destructive)" }}>{prDiffError}</div>
          )}
          {!prDiffError && prDiffBusy && !prDiffText && (
            <div style={{ padding: 10, fontSize: 12, color: "var(--text-dim)" }}>…</div>
          )}
          {prDiffText && (
            <pre
              style={{
                margin: 0,
                padding: "8px 10px 12px",
                fontSize: 11.5,
                lineHeight: 1.45,
                fontFamily: "var(--font-mono)",
                whiteSpace: "pre",
                overflowX: "auto",
              }}
            >
              {prDiffText.split("\n").map((line, i) => {
                let color = "var(--text-muted)";
                if (line.startsWith("+") && !line.startsWith("+++")) color = "var(--success)";
                else if (line.startsWith("-") && !line.startsWith("---")) color = "var(--destructive)";
                else if (line.startsWith("@@")) color = "var(--text-dim)";
                return (
                  <div key={i} style={{ color }}>{line || "\u00a0"}</div>
                );
              })}
            </pre>
          )}
        </div>
      )}

      {(error || notice) && (
        <div className={`git-panel-notice ${error ? "is-error" : "is-ok"}`}>
          {error ? `${t("git.error")}: ${error}` : notice}
        </div>
      )}

      {conflicts.length > 0 && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--destructive-border)",
            background: "var(--destructive-bg)",
            color: "var(--destructive)",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <strong style={{ fontWeight: 600 }}>{t("git.conflictCount", { n: conflicts.length })}</strong>
          {" — "}
          {t("git.conflictHint")}
        </div>
      )}

      {merging && conflicts.length === 0 && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{t("git.merging")}</span>
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={busy || completingMerge}
            onClick={() => void completeMerge()}
            style={{ marginLeft: "auto" }}
          >
            {completingMerge ? t("git.completeMergeRunning") : t("git.completeMerge")}
          </button>
        </div>
      )}

      {splitOpen && (
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <strong style={{ fontWeight: 600 }}>{t("git.splitPlan")}</strong>
            {splitSource && (
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                {splitSource === "ai" ? t("git.splitSourceAi") : t("git.splitSourceHeuristic")}
              </span>
            )}
            <button
              type="button"
              className="chrome-btn"
              style={{ marginLeft: "auto", height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}
              onClick={() => setSplitOpen(false)}
            >
              {t("common.close")}
            </button>
          </div>
          {splitGroups.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("git.splitEmpty")}</div>
          ) : (
            splitGroups.map((g, idx) => (
              <div
                key={g.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 8,
                  background: "var(--bg-panel)",
                }}
              >
                <input
                  className="input-base input-mono"
                  value={g.message}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSplitGroups((prev) => prev.map((x, i) => (i === idx ? { ...x, message: value, title: value } : x)));
                  }}
                  style={{ width: "100%", height: 28, fontSize: 12, marginBottom: 6 }}
                />
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  {g.paths.map((p) => relPath(p, status?.repositoryRoot ?? null)).join(", ")}
                </div>
                {g.rationale && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{g.rationale}</div>
                )}
              </div>
            ))
          )}
          {splitUnassigned.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("git.unassigned")}: {splitUnassigned.map((p) => relPath(p, status?.repositoryRoot ?? null)).join(", ")}
            </div>
          )}
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={busy || splitExecuting || splitGroups.length === 0 || conflicts.length > 0}
            onClick={() => void executeSplit()}
            style={{ alignSelf: "flex-start" }}
          >
            {splitExecuting ? t("git.splitRunning") : t("git.splitExecute")}
          </button>
        </div>
      )}

      {(
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
                onResolveConflict={(action) => void resolveConflict(file.filePath, action)}
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
  onResolveConflict,
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
  onResolveConflict?: (action: "ours" | "theirs" | "base" | "ai") => void;
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

        {(hovered || isConflict) && (
          <div className="git-file-actions" onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {isConflict && onResolveConflict && (
              <>
                <button type="button" className="chrome-btn" disabled={busy} onClick={() => onResolveConflict("ours")}
                  style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}
                  title={t("git.resolveOurs")}>
                  {t("git.resolveOurs")}
                </button>
                <button type="button" className="chrome-btn" disabled={busy} onClick={() => onResolveConflict("theirs")}
                  style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}
                  title={t("git.resolveTheirs")}>
                  {t("git.resolveTheirs")}
                </button>
                <button type="button" className="chrome-btn" disabled={busy} onClick={() => onResolveConflict("base")}
                  style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}
                  title={t("git.resolveBase")}>
                  {t("git.resolveBase")}
                </button>
                <button type="button" className="chrome-btn" disabled={busy} onClick={() => onResolveConflict("ai")}
                  style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}
                  title={t("git.resolveAi")}>
                  {t("git.resolveAi")}
                </button>
              </>
            )}
            {file.unstaged && file.status !== "conflict" && (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onDiscard}
                style={{ color: "var(--destructive)", height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}>
                {t("git.discard")}
              </button>
            )}
            {file.status !== "conflict" && (file.staged ? (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onUnstage}
                style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}>
                {t("git.unstage")}
              </button>
            ) : (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onStage}
                style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}>
                {t("git.stage")}
              </button>
            ))}
            {file.status === "conflict" && (
              <button type="button" className="chrome-btn" disabled={busy} onClick={onStage}
                style={{ height: 24, minHeight: 24, padding: "0 8px", fontSize: 11 }}
                title={t("git.conflictHint")}>
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
