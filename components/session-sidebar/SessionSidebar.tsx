"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type { SessionInfo } from "@/lib/types";
import { FileExplorer, type FileExplorerHandle } from "../FileExplorer";
import { DirectoryPicker } from "../DirectoryPicker";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import {
  buildSessionTree,
  displayCwd,
  getRecentProjects,
  groupSessionTreeByTime,
  loadUnreadSessionIds,
  sameIdSet,
  saveUnreadSessionIds,
  sessionTimeBucketLabel,
  type WorktreeEntry,
  type WorktreeState,
} from "./session-sidebar-helpers";
import { AnimatedDropdown, PathLabel } from "./sidebar-ui";
import { SessionTreeItem } from "./SessionTreeItem";
import { apiFetch } from "@/lib/api-transport";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
      setTheme?: (theme: "light" | "dark") => Promise<"light" | "dark">;
      windowMinimize?: () => Promise<void>;
      windowMaximizeToggle?: () => Promise<{ maximized?: boolean } | void>;
      windowClose?: () => Promise<void>;
      windowIsMaximized?: () => Promise<boolean>;
      windowState?: () => Promise<{ maximized?: boolean }>;
      onWindowStateChange?: (
        callback: (state: { maximized?: boolean }) => void,
      ) => () => void;
      notify?: (payload: { title: string; body: string; silent?: boolean; force?: boolean }) => Promise<{ ok?: boolean }>;
      notifyUiReady?: () => void;
      isDesktop?: boolean;
      platform?: string;
    };
  }
}

export interface SessionSidebarProps {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  /** Fired after a successful rename or auto-title (id + new name). */
  onSessionRenamed?: (sessionId: string, name: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
}

export const SessionSidebar = memo(function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, onSessionRenamed, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onExplorerRefresh, onAtMention, onAtMentions }: SessionSidebarProps) {
  const { t } = useLocale();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [wtFilter, setWtFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  // false: first-stage confirm for a clean worktree; true: server reported
  // uncommitted changes and the next confirm force-removes.
  const [wtConfirmForce, setWtConfirmForce] = useState(false);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const RUNNING_SESSIONS_POLL_MS = 2500;
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await apiFetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        setRunningSessionIds((prev) => {
          const next = new Set(data.runningSessionIds ?? []);
          return sameIdSet(prev, next) ? prev : next;
        });
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    // Visible-tab polling instead of a long-lived running SSE: multi-window setups
    // used to hold one idle EventSource per tab.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await apiFetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as { runningSessionIds?: string[] };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        // Keep Set identity when ids are unchanged to avoid re-rendering every row.
        setRunningSessionIds((prev) => {
          const next = new Set(data.runningSessionIds ?? []);
          return sameIdSet(prev, next) ? prev : next;
        });
      } catch {
        // Keep last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      // Only allocate when the marker set really changes — otherwise a running
      // session would hand every row a new Set (and rewrite localStorage) on
      // every poll tick. The two id lists are disjoint by construction, so
      // testing against `prev` stays correct while building `next`.
      setUnreadSessionIds((prev) => {
        let next: Set<string> | null = null;
        for (const id of newlyRunning) {
          if (!prev.has(id)) continue;
          next ??= new Set(prev);
          next.delete(id);
        }
        for (const id of completedInBackground) {
          if (prev.has(id)) continue;
          next ??= new Set(prev);
          next.add(id);
        }
        return next ?? prev;
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    apiFetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
    const match = allSessions.find((s) => s.cwd === cwd);
    return match?.projectRoot ?? cwd;
  }, [worktreeState, allSessions]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    apiFetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  const commitCustomPath = useCallback(async (candidate: string): Promise<boolean> => {
    const path = candidate.trim();
    if (!path || customPathValidating) return false;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await apiFetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setSelectedCwd(data.cwd ?? path);
      setCustomPathOpen(false);
      setDropdownOpen(false);
      return true;
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValidating]);

  const handleCustomPathClick = useCallback(async () => {
    const desktop = window.piDesktop;
    // Electron: native folder dialog. Browser: browsable DirectoryPicker modal.
    if (desktop?.selectDirectory) {
      try {
        setCustomPathError(null);
        const path = await desktop.selectDirectory();
        if (path === null) return;
        const ok = await commitCustomPath(path);
        if (!ok) setCustomPathOpen(true);
      } catch (e) {
        setCustomPathOpen(true);
        setCustomPathError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    setCustomPathOpen(true);
    setCustomPathError(null);
    setDropdownOpen(false);
  }, [commitCustomPath]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await apiFetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await apiFetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectRootFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await apiFetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          setWtConfirmForce(true);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      setWtConfirmForce(false);
      if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, selectedCwd]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
        // DirectoryPicker is a body portal — do not close it from sidebar outside-click.
        if (!customPathOpen) {
          setCustomPathError(null);
        }
      }
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
        setWtFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [customPathOpen]);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s);
  }, [onSelectSession]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  // Derived session data is memoized: any AppShell render (right-panel drag,
  // running-id SSE frame, refresh timers) re-renders the sidebar, and these
  // passes are O(sessions) with Map/sort allocations.
  const recentProjects = useMemo(() => getRecentProjects(allSessions), [allSessions]);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = useMemo(() => {
    const needle = projectFilter.trim().toLowerCase();
    if (!needle) return recentProjects;
    return recentProjects.filter((p) => p.toLowerCase().includes(needle));
  }, [recentProjects, projectFilter]);

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = useMemo(() => projectRootFor(selectedCwd), [projectRootFor, selectedCwd]);
  const filteredSessions = useMemo(() => (
    selectedProject
      ? allSessions.filter((s) => (s.projectRoot ?? s.cwd) === selectedProject)
      : allSessions
  ), [allSessions, selectedProject]);
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject === worktreeState.projectRoot
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject === worktreeState.projectRoot
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
            label: t("sidebar.openRepoRoot"),
            title: t("sidebar.openRepoRootHint"),
          }
        : {
            label: t("sidebar.gitRootOnly"),
            title: t("sidebar.worktreesRootOnly"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
          label: t("sidebar.worktreesChecking"),
          title: t("sidebar.worktreesCheckingHint"),
        }
      : null);

  // Build parent-child tree within the filtered set
  const sessionTree = useMemo(() => buildSessionTree(filteredSessions), [filteredSessions]);
  // Local-day bucket edges are recomputed with the grouping, so a day rollover
  // is picked up on the next session refresh without any timer.
  const sessionGroups = useMemo(() => groupSessionTreeByTime(sessionTree), [sessionTree]);

  const handleSessionRenamed = useCallback((sessionId?: string, name?: string) => {
    void loadSessions();
    if (sessionId && name) onSessionRenamed?.(sessionId, name);
  }, [loadSessions, onSessionRenamed]);

  const handleSessionDeletedFromList = useCallback((id: string) => {
    onSessionDeleted?.(id);
    void loadSessions();
  }, [onSessionDeleted, loadSessions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {customPathOpen && (
        <DirectoryPicker
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* Header mirrors AppShell top bar: flat 36px strips + vertical dividers.
          Project/worktree pickers MUST stay titlebar-no-drag or Electron steals clicks. */}
      <div
        className="sidebar-desktop-header"
        style={{ flexShrink: 0 }}
      >
        {/* Row 1: project path + New + Refresh — height matches app top bar on macOS */}
        {/* position:relative on the full row so the project menu spans the whole sidebar (like worktree). */}
        <div
          ref={dropdownRef}
          className="sidebar-toolbar-row sidebar-desktop-title-row titlebar-drag"
          style={{ position: "relative" }}
        >
          {/* macOS: reserves space under traffic lights; --traffic-lights-pad is 0 elsewhere */}
          <div className="titlebar-drag traffic-lights-spacer" aria-hidden />
          <div className="titlebar-no-drag" style={{ flex: 1, minWidth: 0, display: "flex" }}>
            <button
              type="button"
              className={`sidebar-strip-btn sidebar-strip-grow${selectedCwd ? "" : " is-empty"}${dropdownOpen ? " is-active" : ""}`}
              onClick={() => setDropdownOpen((v) => !v)}
              title={selectedProject ?? selectedCwd ?? ""}
              style={{ WebkitAppRegion: "no-drag", width: "100%" } as React.CSSProperties}
            >
              {selectedCwd ? (
                <PathLabel
                  text={displayCwd(selectedProject ?? selectedCwd, homeDir)}
                  style={{
                    flex: 1,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "inherit",
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  {initialSessionId && !restoredRef.current ? "" : t("sidebar.selectProject")}
                </span>
              )}
              <Icon icon={ChevronDown} size={9} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.55 }} />
            </button>
          </div>

            <AnimatedDropdown
              open={dropdownOpen}
              className="menu-card"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 100,
              }}
            >
              {showProjectFilter && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    className="input-base input-mono"
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setProjectFilter("");
                        setDropdownOpen(false);
                      }
                    }}
                    placeholder={t("sidebar.filterProjects")}
                    autoFocus
                  />
                </div>
              )}
              <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
                {visibleProjects.map((project) => (
                  <button
                    key={project}
                    className={`sidebar-menu-item${project === selectedProject ? " sidebar-menu-item-active" : ""}`}
                    onClick={() => {
                      setSelectedCwd(project);
                      setProjectFilter("");
                      setCustomPathOpen(false);
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }}
                    style={{ fontFamily: "var(--font-mono)" }}
                    title={project}
                  >
                    {project === selectedProject ? (
                      <Icon icon={Check} size={10} strokeWidth={2} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    ) : (
                      <span style={{ width: 10, flexShrink: 0 }} />
                    )}
                    <PathLabel text={displayCwd(project, homeDir)} style={{ flex: 1 }} />
                  </button>
                ))}
                {visibleProjects.length === 0 && projectFilter.trim() && (
                  <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-dim)" }}>{t("sidebar.noMatchingProjects")}</div>
                )}
              </div>

              {/* Default cwd shortcut */}
              {!customPathOpen && (
                <button
                  className="sidebar-menu-item"
                  onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                  style={{ borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none" }}
                >
                  <Icon icon={Folder} size={10} strokeWidth={1.4} style={{ flexShrink: 0 }} />
                  <span>{t("sidebar.useDefaultDir")}</span>
                </button>
              )}

              {/* Custom path / directory picker */}
              <button
                className="sidebar-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleCustomPathClick();
                }}
              >
                <Icon icon={Plus} size={10} strokeWidth={1.4} style={{ flexShrink: 0 }} />
                <span>{t("sidebar.customPath")}</span>
              </button>
            </AnimatedDropdown>

          <button
            type="button"
            className="sidebar-strip-btn sidebar-strip-action titlebar-no-drag"
            onClick={() => {
              setDropdownOpen(false);
              handleNewSession();
            }}
            disabled={!selectedCwd}
            title={selectedCwd ? t("sidebar.newSessionIn", { cwd: selectedCwd }) : t("sidebar.selectProjectFirst")}
          >
            <Icon icon={Plus} size={12} strokeWidth={2} />
            {t("common.new")}
          </button>
          <button
            type="button"
            className={`sidebar-strip-btn sidebar-strip-icon titlebar-no-drag${sessionRefreshDone ? " is-success" : ""}`}
            onClick={() => {
              setDropdownOpen(false);
              loadSessions(false);
            }}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
          >
            {sessionRefreshDone ? (
              <Icon icon={Check} size={15} strokeWidth={2.5} />
            ) : (
              <Icon icon={RefreshCw} size={15} strokeWidth={1.8} />
            )}
          </button>
        </div>

        {/* Worktree switcher — second flat strip, same language as top bar */}
        {showWorktreeSwitcher && (() => {
          if (!worktreeState) return null;
          const currentWt = worktreeState.worktrees.find((w) => w.path === selectedCwd)
            ?? worktreeState.worktrees.find((w) => w.isMain);
          const showWtFilter = worktreeState.worktrees.length >= 8;
          const visibleWorktrees = showWtFilter && wtFilter.trim()
            ? worktreeState.worktrees.filter((w) =>
                (w.branch ?? displayCwd(w.path, homeDir)).toLowerCase().includes(wtFilter.trim().toLowerCase()))
            : worktreeState.worktrees;
            return (
            <div ref={wtDropdownRef} className="sidebar-toolbar-row titlebar-no-drag" style={{ position: "relative" }}>
              <button
                type="button"
                className={`sidebar-strip-btn sidebar-strip-grow${wtDropdownOpen ? " is-active" : ""}`}
                onClick={() => setWtDropdownOpen((v) => !v)}
                title={currentWt ? t("sidebar.switchWorktreeNamed", { name: currentWt.path }) : t("sidebar.switchWorktree")}
                style={{ WebkitAppRegion: "no-drag", width: "100%" } as React.CSSProperties}
              >
                <Icon
                  icon={GitBranch}
                  size={12}
                  strokeWidth={1.8}
                  style={{ flexShrink: 0, opacity: currentWt && !currentWt.isMain ? 1 : 0.55 }}
                />
                <PathLabel
                  text={currentWt ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "inherit" }}
                />
                {currentWt?.isMain && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>main</span>
                )}
                {worktreeState.worktrees.length > 1 && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                    {worktreeState.worktrees.length}
                  </span>
                )}
                <Icon icon={ChevronDown} size={9} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.55 }} />
              </button>

              <AnimatedDropdown
                open={wtDropdownOpen}
                className="menu-card"
                style={{
                  position: "absolute",
                  top: "calc(100% + 0px)",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                }}
              >
                  {showWtFilter && (
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      <input
                        value={wtFilter}
                        onChange={(e) => setWtFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setWtFilter("");
                            setWtDropdownOpen(false);
                          }
                        }}
                        placeholder={t("sidebar.filterWorktrees")}
                        autoFocus
                        className="input-base"
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          borderRadius: 0,
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}
                  <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                    {visibleWorktrees.map((wt) => {
                      const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "var(--destructive-bg)" }}>
                            <span style={{ flex: 1, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {wtConfirmForce ? t("sidebar.forceRemoveDirty") : t("sidebar.confirmRemoveWorktree")}
                            </span>
                            <button
                              className="btn-danger btn-compact"
                              onClick={() => void handleRemoveWorktree(wt.path, wtConfirmForce)}
                              disabled={wtBusy}
                              style={{ flexShrink: 0 }}
                            >
                              {wtConfirmForce ? t("common.force") : t("common.delete")}
                            </button>
                            <button
                              className="btn-ghost btn-compact"
                              onClick={() => { setWtConfirmRemove(null); setWtConfirmForce(false); }}
                              style={{ flexShrink: 0 }}
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          className="wt-row"
                          style={{ display: "flex", alignItems: "center" }}
                        >
                          <button
                            className={`sidebar-menu-item${isCurrent ? " sidebar-menu-item-active" : ""}`}
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                              setWtFilter("");
                            }}
                            title={wt.path}
                            style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                          >
                            {isCurrent ? (
                              <Icon icon={Check} size={10} strokeWidth={2} style={{ color: "var(--accent)", flexShrink: 0 }} />
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
                            )}
                            <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                            {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>main</span>}
                          </button>
                          {!wt.isMain && (
                            <button
                              className="icon-btn"
                              onClick={() => { setWtConfirmRemove(wt.path); setWtConfirmForce(false); }}
                              disabled={wtBusy}
                              title={t("sidebar.removeWorktree", { path: wt.path })}
                              aria-label={t("sidebar.removeWorktree", { path: wt.path })}
                              style={{ "--icon-btn-size": "26px", marginRight: 4 } as React.CSSProperties}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--destructive)"; e.currentTarget.style.background = "color-mix(in oklab, var(--destructive) 10%, transparent)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = ""; e.currentTarget.style.background = ""; }}
                            >
                              <Icon icon={Trash2} size={12} strokeWidth={1.8} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
                      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>
                        {t("sidebar.noMatchingWorktrees")}
                      </div>
                    )}
                  </div>

                  {!wtNewOpen ? (
                    <button
                      className="sidebar-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("sidebar.createWorktreeHint")}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <Icon icon={Plus} size={10} strokeWidth={1.4} style={{ flexShrink: 0 }} />
                      <span>{t("sidebar.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px", borderTop: "1px solid var(--border)" }}>
                      <input
                        ref={wtNewInputRef}
                        className="input-base input-mono"
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                        placeholder={t("sidebar.branchName")}
                        style={{ borderColor: "var(--accent)" }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                        <button
                          className="btn-primary btn-compact"
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
                          style={{ flex: 1 }}
                        >
                          {wtBusy ? t("common.creating") : t("common.create")}
                        </button>
                        <button
                          className="btn-ghost btn-compact"
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                          style={{ flex: 1 }}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div style={{
                      padding: "5px 10px 8px",
                      color: "var(--destructive)",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
            </div>
          );
        })()}
        {inactiveWorktreeSelector && (
          <div className="sidebar-toolbar-row titlebar-no-drag">
            <button
              type="button"
              className="sidebar-strip-btn sidebar-strip-grow"
              aria-disabled="true"
              tabIndex={-1}
              title={inactiveWorktreeSelector.title}
              style={{ width: "100%", whiteSpace: "nowrap" }}
            >
              <Icon icon={GitBranch} size={12} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.55 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
            </button>
          </div>
        )}
      </div>

      {/* Session list */}
      <div style={{ flex: explorerOpen && (selectedCwdProp || selectedCwd) ? "1 1 0" : "1 1 auto", overflowY: "auto", padding: "0", minHeight: 80 }}>
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("common.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "var(--destructive)", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && filteredSessions.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.noSessions")}
          </div>
        )}
        {sessionGroups.map(({ bucket, nodes }, groupIndex) => (
          <div key={bucket} className="sidebar-session-group">
            <div
              className="sidebar-session-group-label"
              style={{
                padding: groupIndex === 0 ? "8px 12px 4px" : "12px 12px 4px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                color: "var(--text-dim)",
                userSelect: "none",
                lineHeight: 1.3,
              }}
            >
              {sessionTimeBucketLabel(bucket, t)}
            </div>
            {nodes.map((node) => (
              <SessionTreeItem
                key={node.session.id}
                node={node}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                onSelectSession={handleSelectSessionFromList}
                onRenamed={handleSessionRenamed}
                onSessionDeleted={handleSessionDeletedFromList}
                depth={0}
              />
            ))}
          </div>
        ))}
      </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Reuse strip grammar; hide top border since section already has borderTop */}
          <div className="sidebar-toolbar-row" style={{ flexShrink: 0, borderBottom: explorerOpen ? "1px solid var(--border)" : "none" }}>
            <button
              className="sidebar-section-label"
              onClick={() => setExplorerOpen((v) => !v)}
            >
              <Icon
                icon={ChevronRight}
                size={9}
                strokeWidth={1.8}
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              />
              {t("sidebar.explorer")}
            </button>
            {explorerOpen && (
              <button
                type="button"
                className="sidebar-strip-btn sidebar-strip-icon"
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sidebar.uploadToRoot")}
                aria-label={t("sidebar.uploadFiles")}
              >
                <Icon icon={Upload} size={13} strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              className={`sidebar-strip-btn sidebar-strip-icon${explorerRefreshDone ? " is-success" : ""}`}
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("sidebar.refreshExplorer")}
              aria-label={t("sidebar.refreshExplorer")}
            >
              {explorerRefreshDone ? (
                <Icon icon={Check} size={13} strokeWidth={2.5} />
              ) : (
                <Icon icon={RefreshCw} size={13} strokeWidth={1.8} />
              )}
            </button>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});


