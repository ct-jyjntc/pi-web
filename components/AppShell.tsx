"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bug,
  CircleGauge,
  FileText,
  Folder,
  Menu,
  PanelLeft,
  PanelRight,
  Plus,
  Settings,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
// Sidebar is always on first paint — keep it static so cold start never shows a
// blank panel while a dynamic chunk downloads (that looked like a broken UI).
import { SessionSidebar } from "./SessionSidebar";
import { TabBar, type Tab } from "./TabBar";
import { hydrateAppearanceFromServer } from "@/lib/appearance-store";
import { SessionInspectDialogs } from "./session-inspect/SessionInspectDialogs";
import { ChildTranscriptDialog } from "./session-inspect/ChildTranscriptDialog";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "@/lib/chat-input-types";
import { ContextTabBadge } from "./ContextTabBadge";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { WindowControls } from "./WindowControls";
import { getSessionStatsMetric, setSessionStatsMetric } from "@/lib/session-metrics-store";
import { TopBarChromeWidgets } from "./TopBarChromeWidgets";
import { TopBarSessionTitle } from "./TopBarSessionTitle";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";
import { getAppUpdateInfo, startAppUpdateAutoCheck, subscribeAppUpdate } from "@/lib/app-update-store";
import type { ProjectTrustStatus, SkillInfo } from "@/lib/api-types";
import { setDraft } from "@/lib/draft-store";
import { invalidateUsage } from "./UsagePanel";
import { formatShortcut, modKeyLabel } from "@/lib/keyboard";
import { Icon } from "./Icon";

import {
  ChatWindow,
  ContextPanel,
  DebugPanel,
  FileViewer,
  GitPanel,
  SettingsPage,
  TerminalPanel,
} from "./app-shell/lazy-panels";
import {
  EXPLORER_REFRESH_DEBOUNCE_MS,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_WIDTH_KEY,
  SESSION_REFRESH_DEBOUNCE_MS,
  SIDEBAR_MAX,
  SIDEBAR_MAX_VIEWPORT_FRACTION,
  SIDEBAR_MIN,
  SIDEBAR_WIDTH_KEY,
} from "./app-shell/app-shell-constants";
import { ShellStyles } from "./app-shell/ShellStyles";
import { WORKSPACE_TABS } from "./app-shell/terminal-tabs";
import { useAppShellTerminal } from "@/hooks/useAppShellTerminal";
import { usePersistedPanelWidth } from "@/hooks/usePersistedPanelWidth";
import { apiFetch } from "@/lib/api-transport";
import { subscribeWorkspaceFilesChanged } from "@/lib/workspace-change-notify";


export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Force-remount epoch for ChatWindow (fork/trust/project switch). Session
  // identity is the primary key — re-selecting the same id must NOT bump this.
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Once true, SettingsPage stays mounted (hidden when closed) so reopening is
  // instant and its state survives. Flipped on first open, hover, or idle.
  const [settingsWarm, setSettingsWarm] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const handleModelsChanged = useCallback(() => {
    setModelsRefreshKey((k) => k + 1);
  }, []);
  const appUpdate = useSyncExternalStore(subscribeAppUpdate, getAppUpdateInfo, () => null);

  // Background update check when Settings → auto-check is enabled.
  useEffect(() => {
    startAppUpdateAutoCheck({ delayMs: 8_000 });
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    hydrateAppearanceFromServer();
  }, []);
  // Warm-mount the lazily-loaded SettingsPage (hidden) once the shell is idle:
  // the chunk loads AND the component mounts + fetches its data in the
  // background, so the first visible open is instant — no blank flash while
  // the chunk compiles/loads.
  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const idleId = requestIdleCallback(() => setSettingsWarm(true), { timeout: 5000 });
      return () => cancelIdleCallback(idleId);
    }
    const timer = window.setTimeout(() => setSettingsWarm(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  // Electron immersive chrome: mark html so CSS can pad under traffic lights / enable drag.
  // Also toggle pi-desktop-fullscreen so macOS can drop --traffic-lights-pad when the
  // system chrome no longer occupies the top-left (enter/leave-full-screen).
  useEffect(() => {
    const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
    if (!desktop?.isDesktop) return;
    const root = document.documentElement;
    const platformClass =
      desktop.platform === "darwin"
        ? "pi-desktop-mac"
        : desktop.platform === "win32"
          ? "pi-desktop-win"
          : desktop.platform === "linux"
            ? "pi-desktop-linux"
            : null;
    root.classList.add("pi-desktop");
    if (platformClass) root.classList.add(platformClass);

    const applyFullscreen = (fullscreen: boolean) => {
      root.classList.toggle("pi-desktop-fullscreen", fullscreen);
    };
    applyFullscreen(false);
    void desktop.windowState?.().then((state) => {
      applyFullscreen(Boolean(state?.fullscreen));
    }).catch(() => {});
    const unsub = desktop.onWindowStateChange?.((state) => {
      applyFullscreen(Boolean(state?.fullscreen));
    });

    return () => {
      unsub?.();
      root.classList.remove(
        "pi-desktop",
        "pi-desktop-mac",
        "pi-desktop-win",
        "pi-desktop-linux",
        "pi-desktop-fullscreen",
      );
    };
  }, []);

  // Tell Electron the shell has painted so cold-start splash can be dismissed.
  // Double rAF waits until layout + paint, not just commit.
  useLayoutEffect(() => {
    const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
    if (!desktop?.isDesktop || typeof desktop.notifyUiReady !== "function") return;
    let cancelled = false;
    let outer = 0;
    let inner = 0;
    outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        if (!cancelled) desktop.notifyUiReady?.();
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session metrics live in session-metrics-store (ContextPanel/ContextTabBadge subscribe).
  // Trailing-edge debounce timers for the post-turn refreshes (see handleAgentEnd).
  const agentEndTimersRef = useRef<{
    sessions: ReturnType<typeof setTimeout> | null;
    explorer: ReturnType<typeof setTimeout> | null;
  }>({ sessions: null, explorer: null });
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;

  useEffect(() => {
    // Stable ref object; only its timer fields are reassigned.
    const timers = agentEndTimersRef.current;
    return () => {
      if (timers.sessions) clearTimeout(timers.sessions);
      if (timers.explorer) clearTimeout(timers.explorer);
    };
  }, []);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  // Right panel — workspace tabs + drag-resizable width (left sidebar stays fixed)
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const {
    displayWidth: sidebarWidth,
    resizing: sidebarResizing,
    containerRef: sidebarContainerRef,
    handleResizeStart: handleSidebarResizeStart,
    cssVarStyle: sidebarWidthStyle,
  } = usePersistedPanelWidth({
    storageKey: SIDEBAR_WIDTH_KEY,
    cssVar: "--sidebar-width",
    minWidth: SIDEBAR_MIN,
    maxWidth: SIDEBAR_MAX,
    maxViewportFraction: SIDEBAR_MAX_VIEWPORT_FRACTION,
    dragSign: 1,
    enabled: !isMobile && sidebarOpen,
  });
  const {
    displayWidth: rightPanelWidth,
    resizing: rightPanelResizing,
    containerRef: rightPanelContainerRef,
    handleResizeStart: handleRightPanelResizeStart,
    cssVarStyle: rightPanelWidthStyle,
  } = usePersistedPanelWidth({
    storageKey: RIGHT_PANEL_WIDTH_KEY,
    cssVar: "--right-panel-width",
    minWidth: RIGHT_PANEL_MIN,
    maxWidth: RIGHT_PANEL_MAX,
    maxViewportFraction: 0.72,
    dragSign: -1,
    enabled: !isMobile && rightPanelOpen,
    defaultWidth: RIGHT_PANEL_DEFAULT,
  });
  const workspaceTabs = WORKSPACE_TABS;
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string>("review");
  // Workspace panels stay mounted behind display:none once opened so they keep
  // scroll position, expanded diffs and inputs across tab switches. Only the
  // *first* mount is deferred, to the first time the panel is actually shown.
  const [mountedWorkspaceTabIds, setMountedWorkspaceTabIds] = useState<string[]>([]);
  useEffect(() => {
    if (!rightPanelOpen) return;
    setMountedWorkspaceTabIds((prev) => (
      prev.includes(activeWorkspaceTabId) ? prev : [...prev, activeWorkspaceTabId]
    ));
  }, [activeWorkspaceTabId, rightPanelOpen]);
  const terminalWatchCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null;
  const {
    terminalTabs,
    visibleTerminalTabs,
    activeTerminalTabId,
    setActiveTerminalTabId,
    mountedTerminalIds,
    addTerminalSession,
    closeTerminalSession,
  } = useAppShellTerminal({
    t: t as (key: string, params?: Record<string, string | number>) => string,
    isMobile,
    setSidebarOpen,
    setRightPanelOpen,
    setActiveWorkspaceTabId,
    terminalWatchCwd,
  });

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setRightPanelOpen(true);
    setActiveWorkspaceTabId("context");
  }, [isMobile]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
  }, []);

  const initialSessionId = initialNavigation.sessionId;
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses workspace wipe in handleCwdChange during session select / URL restore
  const suppressCwdBumpRef = useRef(false);
  /** Last top-left workspace { cwd, projectRoot } — single compare baseline for switches. */
  const activeWorkspaceRef = useRef<{ cwd: string | null; projectRoot: string | null }>({
    cwd: null,
    projectRoot: null,
  });

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void apiFetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    // Product rule: top-left workspace is the source of truth for every surface.
    // Frontend-only switch — do not kill agents/PTYs; just leave them in the background.
    setActiveCwd(cwd);
    if (!cwd) {
      activeWorkspaceRef.current = { cwd: null, projectRoot: null };
      return;
    }

    const newProject = projectRoot ?? cwd;
    const prev = activeWorkspaceRef.current;

    // Consume suppress always so it cannot stick across a skipped notify.
    const suppressed = suppressCwdBumpRef.current;
    if (suppressed) suppressCwdBumpRef.current = false;

    // Suppress only protects the session/URL that armed it (notify cwd === that session).
    // If suppress was left armed and the user picks another workspace, fall through and switch UI.
    if (suppressed && (!selectedSession || selectedSession.cwd === cwd)) {
      activeWorkspaceRef.current = { cwd, projectRoot: newProject };
      return;
    }

    const cwdChanged = prev.cwd !== null && prev.cwd !== cwd;
    // Project-root refinement for the same path (worktree API resolved) is not a switch.
    const projectRefinedOnly =
      prev.cwd === cwd
      && prev.projectRoot !== null
      && prev.projectRoot !== newProject
      && (prev.projectRoot === prev.cwd || prev.projectRoot === newProject);
    const projectChanged =
      prev.projectRoot !== null
      && newProject !== prev.projectRoot
      && !projectRefinedOnly
      && prev.cwd !== null;

    activeWorkspaceRef.current = { cwd, projectRoot: newProject };

    // First adoption (prev.cwd null) or pure root refinement: record only.
    if (prev.cwd === null || (!cwdChanged && !projectChanged)) {
      return;
    }

    // Align chrome to the new top-left workspace (UI only).
    setFileTabs([]);
    setActiveFileTabId(null);

    // Deselect chat if it isn't at this exact cwd (RPC/agent keeps running).
    const sessionStays = selectedSession?.cwd === cwd;
    if (!sessionStays) {
      setSelectedSession(null);
      setNewSessionCwd(null); // blank chat uses activeCwd via effectiveNewSessionCwd
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      router.replace("/", { scroll: false });
    } else {
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
    }
  }, [router, selectedSession]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    // Same session id: update metadata only. Never remount ChatWindow and never
    // router.replace — both flash "Loading session..." after Settings → Models.
    const sameSession = activeSessionIdRef.current === session.id;
    if (sameSession) {
      setSelectedSession((prev) => {
        if (!prev || prev.id !== session.id) return session;
        return {
          ...prev,
          ...session,
          path: session.path || prev.path,
          name: session.name ?? prev.name,
          projectRoot: session.projectRoot ?? prev.projectRoot,
        };
      });
    } else {
      setSelectedSession(session);
      // ChatWindow key is sessionKey-only (stable across new→real id promote).
      // Different session must bump the epoch so the chat surface remounts.
      setSessionKey((k) => k + 1);
      setSystemPrompt(null);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      branchLeafChangeFnRef.current = null;
    }
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    // Suppress only when the sidebar will actually notify a cwd change. If session.cwd
    // already matches the top-left workspace, onCwdChange may be skipped and a sticky
    // suppress would eat the *next* real workspace switch (chat stuck on old session).
    if (session.cwd !== activeWorkspaceRef.current.cwd) {
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL, OR when already on this session —
    // replace on the same query remounts AppShell via Suspense in production.
    if (!isRestore && !sameSession) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile]);


  const openWorkspaceTab = useCallback((kind: "review" | "files" | "context" | "terminal" | "debug") => {
    setRightPanelOpen(true);
    setActiveWorkspaceTabId(kind);
  }, []);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

  const handleTrySkill = useCallback((skill: SkillInfo) => {
    const cwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
    if (!cwd) return;
    setDraft(`new:${cwd}`, {
      value: "",
      images: [],
      attachedSkill: { name: skill.name, description: skill.description },
    });
    setSettingsOpen(false);
    handleNewSession(`try-${skill.name}`, cwd);
  }, [activeCwd, selectedSession, newSessionCwd, handleNewSession]);

  // Global keyboard shortcuts (Esc, ⌘K search, sidebar, settings, workspace tabs…)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd: activeCwd ?? selectedSession?.cwd ?? newSessionCwd,
    onToggleSidebar: handleSidebarToggle,
    onOpenSettings: () => {
      setSettingsWarm(true);
      setSettingsOpen(true);
    },
    onToggleRightPanel: () => setRightPanelOpen((v) => !v),
    onOpenShortcutsHelp: () => setShortcutsHelpOpen(true),
    onFocusComposer: () => chatInputRef.current?.focus(),
    onWorkspaceTab: openWorkspaceTab,
    suppressEscAbort: shortcutsHelpOpen || settingsOpen,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    // fresh=1: session was just created/forked on heavy; light list cache is stale.
    void apiFetch("/api/sessions?fresh=1")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi.
  // Must NOT bump sessionKey / remount ChatWindow — that wiped the optimistic
  // first message + stream and flashed "Loading session...".
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    // Prefer history.replaceState so Next Suspense does not remount AppShell mid-stream
    // (router.replace on searchParams has remounted the shell in production).
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("session", session.id);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } else {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, hydrateSelectedSession]);

  const scheduleExplorerRefresh = useCallback(() => {
    const timers = agentEndTimersRef.current;
    // Coalesce write/edit bursts and post-turn refresh through one timer.
    if (timers.explorer) clearTimeout(timers.explorer);
    timers.explorer = setTimeout(() => {
      timers.explorer = null;
      setExplorerRefreshKey((k) => k + 1);
    }, EXPLORER_REFRESH_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => subscribeWorkspaceFilesChanged(scheduleExplorerRefresh),
    [scheduleExplorerRefresh],
  );

  const handleAgentEnd = useCallback(() => {
    const timers = agentEndTimersRef.current;
    // The session list only carries messageCount / mtime here — running badges
    // only refresh running badges via visible-tab poll — so it can lag a turn.
    if (timers.sessions) clearTimeout(timers.sessions);
    timers.sessions = setTimeout(() => {
      timers.sessions = null;
      setRefreshKey((k) => k + 1);
      invalidateUsage();
    }, SESSION_REFRESH_DEBOUNCE_MS);
    scheduleExplorerRefresh();
  }, [scheduleExplorerRefresh]);

  const handleSessionRenamed = useCallback((sessionId: string, name: string) => {
    setSelectedSession((current) => (current?.id === sessionId ? { ...current, name } : current));
    const currentStats = getSessionStatsMetric();
    if (currentStats?.sessionId === sessionId) {
      setSessionStatsMetric({ ...currentStats, sessionName: name });
    }
  }, []);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);


  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    // Selection only — SessionSidebar owns list reload after DELETE settles.
    // Bumping refreshKey here raced mid-delete disk scans and reinserted the row.
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    sourceSessionId?: string | null,
    focusLine?: number | null,
  ) => {
    // Files opened from the explorer go into the Files workspace tab.
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) {
        return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId, focusLine: focusLine ?? null }];
      }
      return prev.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          sourceSessionId: sourceSessionId || t.sourceSessionId,
          // bump focusLine even if same tab so FileViewer effect re-runs
          focusLine: focusLine ?? t.focusLine ?? null,
        };
      });
    });
    setActiveFileTabId(tabId);
    setActiveWorkspaceTabId("files");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);


  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      return next;
    });
  }, []);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;

  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);

  useEffect(() => {
      setProjectTrust(null);
      setProjectTrustDialogOpen(false);
      setProjectTrustError(null);
      if (!projectTrustCwd) return;

      const controller = new AbortController();
      // Trust is enforced server-side at session start; the dialog may arrive late.
      // Prefer idle so the first paint of chat content is not racing this request.
      const load = () => {
        apiFetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
          signal: controller.signal,
        })
          .then(async (response) => {
            const data = await response.json() as ProjectTrustStatus & { error?: string };
            if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
            setProjectTrust(data);
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            console.error("Failed to load project trust:", error);
          });
      };

      if (typeof requestIdleCallback === "function") {
        const idleId = requestIdleCallback(load, { timeout: 1500 });
        return () => {
          cancelIdleCallback(idleId);
          controller.abort();
        };
      }
      const timer = window.setTimeout(load, 100);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }, [projectTrustCwd]);

    const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await apiFetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - Pi Web` : "Pi Web";

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const sidebarContent = (
    <div
      className="sidebar-shell"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}
    >
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        onSessionRenamed={handleSessionRenamed}
        // Prefer top-left workspace (activeCwd); fall back to session / new-chat cwd.
        selectedCwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onExplorerRefresh={handleExplorerRefresh}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
      />
    </div>
  );

  return (
    <>
    <ShellStyles />
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "var(--overlay-bg)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarContainerRef}
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizing ? " is-resizing" : ""}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
          ...sidebarWidthStyle,
        }}
      >
        {sidebarContent}
        {sidebarOpen && !isMobile && (
          <div
            className={`sidebar-edge-resizer titlebar-no-drag${sidebarResizing ? " is-active" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-label={t("shell.resizeSidebar")}
            title={t("shell.resizeSidebar")}
            onPointerDown={handleSidebarResizeStart}
          />
        )}
      </div>

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        <div
          className="app-topbar titlebar-drag desktop-top-chrome"
          style={{
            display: "flex",
            alignItems: "stretch",
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            height: "var(--titlebar-height)",
            background: "var(--bg-panel)",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* When sidebar is closed on macOS desktop, leave room for traffic lights.
              --traffic-lights-pad is 0 on web / win / linux. */}
          {!sidebarOpen && (
            <div className="traffic-lights-spacer titlebar-drag" aria-hidden />
          )}
          {/* Left cluster: shell controls — never shrink */}
          <div className="chrome-cluster titlebar-no-drag" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="chrome-btn is-icon"
              onClick={handleSidebarToggle}
              title={`${sidebarOpen ? t("shell.hideSidebar") : t("shell.showSidebar")} (${formatShortcut(modKeyLabel(), "B")})`}
              aria-label={sidebarOpen ? t("shell.hideSidebar") : t("shell.showSidebar")}
            >
              {sidebarOpen ? (
                <Icon icon={PanelLeft} size={16} strokeWidth={2} />
              ) : (
                <Icon icon={Menu} size={18} strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              className="chrome-btn is-icon"
              onClick={() => {
                setSettingsWarm(true);
                setSettingsOpen(true);
              }}
              onPointerEnter={() => setSettingsWarm(true)}
              title={`${t("shell.settings")} (${formatShortcut(modKeyLabel(), ",")})`}
              aria-label={t("shell.settings")}
            >
              <Icon icon={Settings} size={16} strokeWidth={2} />
            </button>
            <TopBarSessionTitle
              session={selectedSession}
              isNewSession={selectedSession === null && showChat}
            />
            {appUpdate && (
              <button
                type="button"
                className="chrome-btn app-update-chip"
                onClick={() => {
                  window.open(appUpdate.releaseUrl, "_blank", "noopener,noreferrer");
                }}
                title={t("shell.updateAvailableTitle", { version: appUpdate.latestVersion })}
                aria-label={t("shell.updateAvailableTitle", { version: appUpdate.latestVersion })}
              >
                <span className="app-update-dot" aria-hidden />
                <span>{t("shell.updateAvailable", { version: appUpdate.latestVersion })}</span>
              </button>
            )}
          </div>
          <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />
          {/* Middle: drag + chat actions + stats — may collapse when narrow */}
          <div className="app-topbar-middle titlebar-drag">
          <div className="titlebar-drag" style={{ flex: 1, minWidth: 8, height: "100%" }} aria-hidden />
          {showChat && (
            <div className="chrome-cluster titlebar-no-drag app-topbar-actions">
              {/* Todo + subagents — quiet status capsules (own popovers) */}
              <TopBarChromeWidgets parentSessionId={selectedSession?.id ?? null} />
            </div>
          )}
          </div>

          {/* Trailing: file panel toggle — always visible, never squeezed out */}
          <div className="app-topbar-trailing titlebar-no-drag">
            <div className="chrome-divider" aria-hidden />
            <button
              type="button"
              className={`chrome-btn is-icon${rightPanelOpen ? " is-active" : ""}`}
              onClick={() => setRightPanelOpen((v) => !v)}
              title={`${rightPanelOpen ? t("shell.hideFilePanel") : t("shell.showFilePanel")} (${formatShortcut(modKeyLabel(), "\\")})`}
              aria-label={rightPanelOpen ? t("shell.hideFilePanel") : t("shell.showFilePanel")}
              style={{ flexShrink: 0 }}
            >
              <Icon icon={PanelRight} size={16} strokeWidth={1.8} />
            </button>
          </div>
          {/* Custom Windows/Linux caption buttons — only when this bar is rightmost. */}
          {!rightPanelOpen && <WindowControls />}

        </div>

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
          {showChat && projectTrust?.requiresTrust && !projectTrust.trusted && (
            <button
              type="button"
              className="chrome-btn"
              onClick={() => {
                setProjectTrustError(null);
                setProjectTrustDialogOpen(true);
              }}
              title={t("trust.resourcesNotLoaded")}
              aria-label={t("trust.resourcesNotLoaded")}
              style={{
                width: "100%",
                height: 32,
                minHeight: 32,
                borderRadius: 0,
                borderBottom: "1px solid var(--border)",
                justifyContent: "flex-start",
                padding: "0 12px",
                gap: 8,
                color: "var(--text-muted)",
                background: "var(--bg-panel)",
                flexShrink: 0,
              }}
            >
              <Icon icon={ShieldAlert} size={13} strokeWidth={1.8} />
              <span style={{ fontSize: 12 }}>{t("trust.resourcesNotLoaded")}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>{t("trust.trustProject")}</span>
            </button>
          )}
          {showChat ? (
            <ChatWindow
              // Epoch only — do not key by session id. First send promotes new→real id;
              // keying by id remounted the surface into "Loading session..." mid-stream.
              key={`chat:${sessionKey}`}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onOpenFile={handleOpenLinkedFile}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--text)" }}>{t("shell.openingWorkspace")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--destructive)" }}>{t("shell.unableOpenWorkspace")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                {t("shell.selectSession")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <Icon
                  icon={ArrowLeft}
                  size={44}
                  strokeWidth={1.5}
                  style={{ color: "var(--accent)", opacity: 0.7, flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("shell.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("shell.step1")}<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{t("shell.step2a")} <strong style={{ color: "var(--text)" }}>{t("shell.settings")}</strong> {t("shell.step2b")}
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/*
        Seam handle: zero layout width, sits exactly between chat rail and right panel.
        Absolute hit target straddles the 1px border (half into rail, half into panel).
      */}
      {rightPanelOpen && !isMobile && (
        <div
          className="right-panel-seam titlebar-no-drag"
          style={{
            position: "relative",
            flex: "0 0 0px",
            width: 0,
            minWidth: 0,
            alignSelf: "stretch",
            zIndex: 60,
            overflow: "visible",
          }}
        >
          <div
            className={`right-panel-edge-resizer${rightPanelResizing ? " is-active" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={rightPanelWidth}
            aria-valuemin={RIGHT_PANEL_MIN}
            aria-valuemax={RIGHT_PANEL_MAX}
            aria-label={t("shell.resizeFilePanel")}
            title={t("shell.resizeFilePanel")}
            onPointerDown={handleRightPanelResizeStart}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              // Center on the seam: 4px into rail, 4px into panel
              left: -4,
              width: 8,
              minWidth: 8,
              maxWidth: 8,
              cursor: "col-resize",
              touchAction: "none",
              background: rightPanelResizing
                ? "color-mix(in oklab, var(--accent) 30%, transparent)"
                : "transparent",
            }}
          />
        </div>
      )}

      {/* Right panel */}
      <div
        ref={rightPanelContainerRef}
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizing ? " is-resizing" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: rightPanelOpen ? "1px solid var(--border)" : "none",
          background: "var(--bg)",
          position: "relative",
          overflow: "hidden",
          ...rightPanelWidthStyle,
        }}
      >
        {/* Workspace tabs: Review | Files | Context | Terminal — all permanent */}
        <div className="app-topbar titlebar-drag desktop-top-chrome" style={{ display: "flex", flexDirection: "row", alignItems: "stretch", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: "var(--titlebar-height)" }}>
          <div className="titlebar-no-drag right-workspace-tabs">
            {workspaceTabs.map((tab) => {
              const active = tab.id === activeWorkspaceTabId;
              const label =
                tab.kind === "review" ? t("git.review")
                  : tab.kind === "files" ? t("git.files")
                    : tab.kind === "context" ? t("shell.contextTab")
                      : tab.kind === "debug" ? t("debug.title")
                        : t("git.terminal");
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`right-workspace-tab${active ? " is-active" : ""}`}
                  onClick={() => setActiveWorkspaceTabId(tab.id)}
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                >
                  {tab.kind === "review" ? (
                    <Icon icon={FileText} size={12} strokeWidth={1.8} />
                  ) : tab.kind === "files" ? (
                    <Icon icon={Folder} size={12} strokeWidth={1.8} />
                  ) : tab.kind === "context" ? (
                    <Icon icon={CircleGauge} size={12} strokeWidth={1.8} />
                  ) : tab.kind === "debug" ? (
                    <Icon icon={Bug} size={12} strokeWidth={1.8} />
                  ) : (
                    <Icon icon={Terminal} size={12} strokeWidth={1.8} />
                  )}
                  <span className="right-workspace-tab-label">{label}</span>
                  {tab.kind === "context" && <ContextTabBadge />}
                  {tab.kind === "files" && fileTabs.length > 0 && (
                    <span className="right-workspace-tab-count">{fileTabs.length}</span>
                  )}
                  {tab.kind === "terminal" && visibleTerminalTabs.length > 0 && (
                    <span className="right-workspace-tab-count">{visibleTerminalTabs.length}</span>
                  )}
                </button>
              );
            })}
            <div className="titlebar-drag" style={{ flex: 1, height: "100%" }} aria-hidden />
          </div>
          {/* Right panel is the rightmost chrome when open — host caption buttons here. */}
          <WindowControls />
        </div>

        <div style={{ flex: 1, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          {/* Panels mount on first open and stay mounted (hidden) afterwards,
              so switching tabs never resets their internal state. */}
          <div style={{
            display: activeWorkspaceTabId === "review" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}>
            {mountedWorkspaceTabIds.includes("review") && (
              <GitPanel
                cwd={activeCwd}
                refreshKey={explorerRefreshKey}
                onReviewSessionStarted={(session) => {
                  setNewSessionCwd(null);
                  setSelectedSession({
                    id: session.id,
                    path: "",
                    cwd: session.cwd,
                    created: new Date().toISOString(),
                    modified: new Date().toISOString(),
                    messageCount: 1,
                    firstMessage: session.name ?? "Git review",
                    name: session.name,
                  });
                  setSessionKey((k) => k + 1);
                  setRefreshKey((k) => k + 1);
                  hydrateSelectedSession(session.id);
                  router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
                  if (isMobile) setSidebarOpen(false);
                }}
              />
            )}
          </div>

          <div style={{
            display: activeWorkspaceTabId === "files" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}>
            {fileTabs.length > 0 && (
              <TabBar
                tabs={fileTabs}
                activeTabId={activeFileTabId ?? ""}
                onSelectTab={setActiveFileTabId}
                onCloseTab={handleCloseFileTab}
              />
            )}
            <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
              {activeFileTab?.filePath ? (
                <FileViewer
                  filePath={activeFileTab.filePath}
                  cwd={activeCwd ?? undefined}
                  sourceSessionId={activeFileTab.sourceSessionId}
                  focusLine={activeFileTab.focusLine}
                  gitRefreshKey={explorerRefreshKey}
                  onMentionLines={rightPanelOpen ? handleFileLineMention : undefined}
                  onMentionFile={rightPanelOpen ? (rel) => handleAtMention(rel, false) : undefined}
                  onOpenFile={(filePath) => handleOpenFile(
                    filePath,
                    getFileName(filePath),
                    activeFileTab.sourceSessionId,
                  )}
                />
              ) : (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
                  {t("shell.noFileOpen")}
                </div>
              )}
            </div>
          </div>

          <div style={{
            display: activeWorkspaceTabId === "context" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}>
            {mountedWorkspaceTabIds.includes("context") && <ContextPanel />}
          </div>

          <div style={{
            display: activeWorkspaceTabId === "debug" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}>
            {mountedWorkspaceTabIds.includes("debug") && (
              <DebugPanel
                cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
                onOpenSource={(filePath, line) => {
                  handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null, line);
                }}
              />
            )}
          </div>

          <div style={{
            display: activeWorkspaceTabId === "terminal" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}>
            {/* Terminal subtabs — only this workspace; other workspaces stay mounted off-screen. */}
            <div className="file-subtabs titlebar-no-drag">
              {visibleTerminalTabs.map((tab) => {
                const isActive = tab.id === activeTerminalTabId;
                return (
                  <div
                    key={tab.id}
                    role="tab"
                    tabIndex={0}
                    className={`file-subtab${isActive ? " is-active" : ""}`}
                    title={tab.label}
                    aria-label={tab.label}
                    aria-selected={isActive}
                    onClick={() => setActiveTerminalTabId(tab.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveTerminalTabId(tab.id);
                      }
                    }}
                    onMouseDown={(e) => {
                      if (e.button === 1) e.preventDefault();
                    }}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return;
                      e.preventDefault();
                      e.stopPropagation();
                      closeTerminalSession(tab.id);
                    }}
                  >
                    <span className="file-subtab-icon" aria-hidden>
                      <Icon icon={Terminal} size={12} strokeWidth={1.8} />
                    </span>
                    <span className="file-subtab-label">{tab.label}</span>
                    <button
                      type="button"
                      className="file-subtab-close"
                      title={t("tab.close")}
                      aria-label={t("tab.closeNamed", { name: tab.label })}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTerminalSession(tab.id);
                      }}
                    >
                      <Icon icon={X} size={10} strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="chrome-btn is-icon file-subtab-add"
                onClick={addTerminalSession}
                title={t("git.newTerminal")}
                aria-label={t("git.newTerminal")}
              >
                <Icon icon={Plus} size={12} strokeWidth={2} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
              {/* Always keep mounted panels for every workspace so PTYs keep running off-screen. */}
              {terminalTabs.map((tab) => {
                if (!mountedTerminalIds.includes(tab.id)) return null;
                const inWorkspace = !tab.cwd || tab.cwd === terminalWatchCwd;
                const active = inWorkspace && tab.id === activeTerminalTabId;
                return (
                  <div
                    key={tab.id}
                    style={{
                      display: active ? "flex" : "none",
                      flexDirection: "column",
                      position: "absolute",
                      inset: 0,
                      minHeight: 0,
                      overflow: "hidden",
                    }}
                  >
                    <TerminalPanel
                      cwd={tab.cwd ?? terminalWatchCwd}
                      attachSessionId={tab.attachSessionId ?? null}
                      sourceLabel={tab.source === "agent" ? tab.label : null}
                      persistRemoteOnUnmount
                    />
                  </div>
                );
              })}
              {visibleTerminalTabs.length === 0 && (
                <div style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "var(--text-dim)",
                  fontSize: 12,
                  position: "relative",
                  zIndex: 1,
                }}>
                  <span>{t("git.terminal")}</span>
                  <button type="button" className="chrome-btn" onClick={addTerminalSession}>
                    {t("git.newTerminal")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    {settingsWarm && (
      <SettingsPage
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd}
        skillsDisabled={!activeCwd && !selectedSession?.cwd && !newSessionCwd}
        onModelsChanged={handleModelsChanged}
        onTrySkill={handleTrySkill}
      />
    )}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
      />
    )}
    <SessionInspectDialogs
      selectedSessionId={selectedSession?.id ?? null}
      tree={branchTree}
      activeLeafId={branchActiveLeafId}
      onLeafChange={handleBranchLeafChange}
      systemPrompt={systemPrompt}
      onSystemPrompt={setSystemPrompt}
    />
    <ChildTranscriptDialog />
    <ShortcutsHelpDialog
      open={shortcutsHelpOpen}
      onClose={() => setShortcutsHelpOpen(false)}
    />
    </>
  );
}
