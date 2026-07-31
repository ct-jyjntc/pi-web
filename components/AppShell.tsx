"use client";

import { useState, useCallback, useRef, useEffect, useSyncExternalStore, type CSSProperties } from "react";
import dynamic from "next/dynamic";
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
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { TabBar, type Tab } from "./TabBar";
import { hydrateAppearanceFromServer } from "@/lib/appearance-store";
import { BranchNavigator } from "./BranchNavigator";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import { ContextTabBadge } from "./ContextTabBadge";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { WindowControls } from "./WindowControls";
import { getSessionStatsMetric, setSessionStatsMetric } from "@/lib/session-metrics-store";
import { TopBarChromeWidgets } from "./TopBarChromeWidgets";
import { getAppUpdateInfo, startAppUpdateAutoCheck, subscribeAppUpdate } from "@/lib/app-update-store";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { Icon } from "./Icon";

/**
 * Lazy panels. None of these can be on screen at first paint — the right
 * workspace starts collapsed and Settings starts closed — so keeping them out
 * of the entry chunk is pure first-load savings with no behaviour change.
 * ContextTabBadge lives in its own leaf module (./ContextTabBadge) so the
 * always-present workspace tab strip does not pin ContextPanel to the entry.
 */
const LAZY_PANEL_FALLBACK_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  height: "100%",
  background: "var(--bg)",
};

/** Fills exactly the box the real panel will occupy, so no layout shift. */
function LazyPanelFallback() {
  return <div style={LAZY_PANEL_FALLBACK_STYLE} aria-hidden />;
}

const FileViewer = dynamic(() => import("./FileViewer").then((m) => m.FileViewer), {
  ssr: false,
  loading: LazyPanelFallback,
});

const GitPanel = dynamic(() => import("./GitPanel").then((m) => m.GitPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

const DebugPanel = dynamic(() => import("./DebugPanel").then((m) => m.DebugPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

const ContextPanel = dynamic(() => import("./ContextPanel").then((m) => m.ContextPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

const TerminalPanel = dynamic(() => import("./TerminalPanel").then((m) => m.TerminalPanel), {
  ssr: false,
  loading: LazyPanelFallback,
});

const SettingsPage = dynamic(() => import("./SettingsPage").then((m) => m.SettingsPage), {
  ssr: false,
  // Blank fallback: AppShell warm-mounts SettingsPage hidden on idle, so a
  // visible white/blank overlay while the chunk loads would be wrong — with a
  // cold chunk the page simply appears a beat late instead of flashing.
  loading: () => null,
});

/**
 * Every turn's `agent_end` used to fire a full session-list reload plus a
 * FileExplorer remount. Debounce both on the trailing edge so back-to-back
 * turns collapse into one refresh; the last one always lands.
 */
const SESSION_REFRESH_DEBOUNCE_MS = 1500;
const EXPLORER_REFRESH_DEBOUNCE_MS = 300;

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Once true, SettingsPage stays mounted (hidden when closed) so reopening is
  // instant and its state survives. Flipped on first open, hover, or idle.
  const [settingsWarm, setSettingsWarm] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
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
    return () => {
      root.classList.remove("pi-desktop", "pi-desktop-mac", "pi-desktop-win", "pi-desktop-linux");
    };
  }, []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

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
  const systemBtnRef = useRef<HTMLButtonElement>(null);

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

  // Single active panel — only one dropdown open at a time
  type TopPanel = "branches" | "system";
  const [activeTopPanel, setActiveTopPanel] = useState<TopPanel | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: TopPanel) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Right panel — workspace tabs + drag-resizable width (left sidebar stays fixed)
  const RIGHT_PANEL_WIDTH_KEY = "pi-right-panel-width";
  const RIGHT_PANEL_MIN = 280;
  const RIGHT_PANEL_MAX = 900;
  const RIGHT_PANEL_DEFAULT = 380;
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Default must match SSR; hydrate width from localStorage after mount.
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT);

  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const rightPanelContainerRef = useRef<HTMLDivElement | null>(null);
  const rightPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const rightPanelDraggingRef = useRef(false);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  // A live drag owns the width and writes it straight to the CSS variable, so
  // an unrelated re-render must not snap the ref back to the committed value.
  if (!rightPanelDraggingRef.current) rightPanelWidthRef.current = rightPanelWidth;
  /** Right workspace: permanent Review | Files | Context | Terminal (like Files, always present) */
  type WorkspaceTab =
    | { id: "review"; kind: "review" }
    | { id: "files"; kind: "files" }
    | { id: "context"; kind: "context" }
    | { id: "debug"; kind: "debug" }
    | { id: "terminal"; kind: "terminal" };
  const workspaceTabs: WorkspaceTab[] = [
    { id: "review", kind: "review" },
    { id: "files", kind: "files" },
    { id: "context", kind: "context" },
    { id: "debug", kind: "debug" },
    { id: "terminal", kind: "terminal" },
  ];
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
  // Terminal sessions live inside the permanent Terminal workspace (like file subtabs).
  type TerminalSessionTab = {
    id: string;
    label: string;
    source: "user" | "agent";
    attachSessionId?: string;
    command?: string;
  };
  const terminalSeqRef = useRef(1);
  const [terminalTabs, setTerminalTabs] = useState<TerminalSessionTab[]>([]);
  const terminalTabsRef = useRef(terminalTabs);
  terminalTabsRef.current = terminalTabs;
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(null);
  // Only mount a session once selected (correct xterm size); keep mounted after for keep-alive.
  const [mountedTerminalIds, setMountedTerminalIds] = useState<string[]>([]);
  const knownAgentPtyIdsRef = useRef(new Set<string>());
  const [gitFocusPath, setGitFocusPath] = useState<string | null>(null);

  const renumberTerminalLabels = useCallback((tabs: TerminalSessionTab[]): TerminalSessionTab[] => {
    let userIndex = 0;
    return tabs.map((tab) => {
      if (tab.source === "agent") {
        const cmd = tab.command?.replace(/\s+/g, " ").trim();
        const short = cmd && cmd.length > 28 ? `${cmd.slice(0, 25)}…` : cmd;
        return {
          ...tab,
          label: short ? `${t("git.terminalAgent")} · ${short}` : t("git.terminalAgent"),
        };
      }
      userIndex += 1;
      return { ...tab, label: `${t("git.terminal")} ${userIndex}` };
    });
  }, [t]);

  const addTerminalSession = useCallback(() => {
    // Synchronous id/label so we can activate + mount in the same click (instant show).
    const prev = terminalTabsRef.current;
    if (prev.filter((tab) => tab.source === "user").length === 0) terminalSeqRef.current = 1;
    const n = terminalSeqRef.current++;
    const id = `term-${n}`;
    const next = renumberTerminalLabels([...prev, { id, label: "", source: "user" }]);
    setTerminalTabs(next);
    setActiveTerminalTabId(id);
    setMountedTerminalIds((mounted) => (mounted.includes(id) ? mounted : [...mounted, id]));
    setActiveWorkspaceTabId("terminal");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, renumberTerminalLabels]);

  const closeTerminalSession = useCallback((tabId: string, options?: { kill?: boolean }) => {
    const kill = options?.kill !== false;
    const closing = terminalTabsRef.current.find((tab) => tab.id === tabId);
    if (closing?.source === "agent" && closing.attachSessionId) {
      knownAgentPtyIdsRef.current.delete(closing.attachSessionId);
      if (kill) {
        void fetch(`/api/cwd/pty/${closing.attachSessionId}`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
    }
    setTerminalTabs((prev) => {
      const next = renumberTerminalLabels(prev.filter((tab) => tab.id !== tabId));
      if (next.length === 0) {
        terminalSeqRef.current = 1;
        setActiveTerminalTabId(null);
        setMountedTerminalIds([]);
      } else {
        setActiveTerminalTabId((cur) => {
          if (cur !== tabId && next.some((tab) => tab.id === cur)) return cur;
          return next[next.length - 1].id;
        });
        setMountedTerminalIds((mounted) => mounted.filter((id) => id !== tabId));
      }
      return next;
    });
  }, [renumberTerminalLabels]);

  const upsertAgentTerminalSession = useCallback((session: {
    id: string;
    command?: string;
    title?: string;
    exited?: boolean;
  }) => {
    const tabId = `agent-${session.id}`;
    // Stopped process → drop the tab instead of leaving a dead terminal around.
    if (session.exited) {
      if (terminalTabsRef.current.some((tab) => tab.id === tabId)) {
        closeTerminalSession(tabId, { kill: true });
      } else {
        knownAgentPtyIdsRef.current.delete(session.id);
      }
      return;
    }
    knownAgentPtyIdsRef.current.add(session.id);
    setTerminalTabs((prev) => {
      const existing = prev.find((tab) => tab.id === tabId);
      if (existing) {
        return renumberTerminalLabels(prev.map((tab) => (
          tab.id === tabId
            ? { ...tab, command: session.command ?? session.title ?? tab.command }
            : tab
        )));
      }
      return renumberTerminalLabels([
        ...prev,
        {
          id: tabId,
          label: "",
          source: "agent",
          attachSessionId: session.id,
          command: session.command ?? session.title,
        },
      ]);
    });
    setActiveTerminalTabId(tabId);
    setMountedTerminalIds((mounted) => (mounted.includes(tabId) ? mounted : [...mounted, tabId]));
    setActiveWorkspaceTabId("terminal");
    setRightPanelOpen(true);
  }, [closeTerminalSession, renumberTerminalLabels]);

  // Ensure active session is in the mounted set (e.g. after switch).
  useEffect(() => {
    if (!activeTerminalTabId) return;
    setMountedTerminalIds((prev) =>
      prev.includes(activeTerminalTabId) ? prev : [...prev, activeTerminalTabId],
    );
  }, [activeTerminalTabId]);

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
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
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
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd) return;
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session or wipe
    // file tabs that still belong to the same project.
    const newProject = projectRoot ?? cwd;
    const currentProject = selectedSession
      ? (selectedSession.projectRoot ?? selectedSession.cwd)
      : (activeCwd ?? null);
    if (currentProject && currentProject === newProject) {
      return;
    }
    // Different project: drop open file tabs (paths from the old tree are stale).
    setFileTabs([]);
    setActiveFileTabId(null);
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router, selectedSession, activeCwd]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    const timers = agentEndTimersRef.current;
    // The session list only carries messageCount / mtime here — running badges
    // only refresh running badges via visible-tab poll — so it can lag a turn.
    if (timers.sessions) clearTimeout(timers.sessions);
    timers.sessions = setTimeout(() => {
      timers.sessions = null;
      setRefreshKey((k) => k + 1);
    }, SESSION_REFRESH_DEBOUNCE_MS);
    // The file tree / git status must show what the agent just wrote, so this
    // only coalesces true bursts instead of adding perceptible latency.
    if (timers.explorer) clearTimeout(timers.explorer);
    timers.explorer = setTimeout(() => {
      timers.explorer = null;
      setExplorerRefreshKey((k) => k + 1);
    }, EXPLORER_REFRESH_DEBOUNCE_MS);
  }, []);

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
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
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

  // Load persisted width after mount (avoid SSR hydration mismatch)
  useEffect(() => {
    // Clear any stuck resize cursor from a previous half-finished drag
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      const raw = window.localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
      const n = raw ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return;
      const max = Math.min(RIGHT_PANEL_MAX, Math.floor(window.innerWidth * 0.72));
      setRightPanelWidth(Math.min(max, Math.max(RIGHT_PANEL_MIN, Math.round(n))));
    } catch {
      // ignore
    }
  }, []);

  // Persist right panel width
  useEffect(() => {
    try {
      window.localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth));
    } catch {
      // ignore quota / private mode
    }
  }, [rightPanelWidth]);

  // Always clear a half-finished resize on unmount
  useEffect(() => () => {
    // A live drag keeps the width in a ref, so the commit in cleanup() lands on
    // an unmounted tree — persist it here instead of losing it.
    const draggedWidth = rightPanelDraggingRef.current ? rightPanelWidthRef.current : null;
    rightPanelResizeCleanupRef.current?.();
    rightPanelResizeCleanupRef.current = null;
    if (draggedWidth !== null) {
      try {
        window.localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(draggedWidth));
      } catch {
        // ignore quota / private mode
      }
    }
  }, []);

  const handleRightPanelResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile || !rightPanelOpen) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();

    // End any previous drag first
    rightPanelResizeCleanupRef.current?.();

    const startX = e.clientX;
    const startW = rightPanelWidthRef.current;
    const handle = e.currentTarget;
    const container = rightPanelContainerRef.current;
    const pointerId = e.pointerId;
    rightPanelDraggingRef.current = true;
    setRightPanelResizing(true);

    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // Left edge: drag left → wider, drag right → narrower
      const delta = startX - ev.clientX;
      const max = Math.min(RIGHT_PANEL_MAX, Math.floor(window.innerWidth * 0.72));
      const next = Math.min(max, Math.max(RIGHT_PANEL_MIN, Math.round(startW + delta)));
      if (next === rightPanelWidthRef.current) return;
      rightPanelWidthRef.current = next;
      // Width only feeds a CSS variable, so drive it straight from the DOM.
      // A setState here would re-render the whole shell on every pointer frame
      // (session tree, open file + syntax highlighting) and freeze the window.
      container?.style.setProperty("--right-panel-width", `${next}px`);
      handle.setAttribute("aria-valuenow", String(next));
    };

    const cleanup = () => {
      if (!rightPanelDraggingRef.current) return;
      rightPanelDraggingRef.current = false;
      setRightPanelResizing(false);
      // Commit once at the end: React state drives persistence and the inline
      // style, and matches the value already written to the DOM (no jump).
      setRightPanelWidth(rightPanelWidthRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
      if (rightPanelResizeCleanupRef.current === cleanup) {
        rightPanelResizeCleanupRef.current = null;
      }
    };

    const onUp = (ev: Event) => {
      if (ev instanceof PointerEvent && ev.pointerId !== pointerId) return;
      cleanup();
    };

    rightPanelResizeCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
  }, [isMobile, rightPanelOpen]);

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
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
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
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
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

  // Discover AI-started PTY sessions and surface them in the Terminal workspace.
  const terminalWatchCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null;
  useEffect(() => {
    if (!terminalWatchCwd) return;
    let es: EventSource | null = null;
    let cancelled = false;

    const ingest = (session: {
      id?: string;
      source?: string;
      command?: string;
      title?: string;
      exited?: boolean;
    }) => {
      if (!session.id || session.source !== "agent") return;
      // Snapshot may include already-dead sessions — never re-open those.
      if (session.exited) {
        const tabId = `agent-${session.id}`;
        if (terminalTabsRef.current.some((tab) => tab.id === tabId)) {
          closeTerminalSession(tabId, { kill: true });
        }
        return;
      }
      upsertAgentTerminalSession({
        id: session.id,
        command: session.command,
        title: session.title,
        exited: false,
      });
    };

    try {
      es = new EventSource(`/api/cwd/pty/events?cwd=${encodeURIComponent(terminalWatchCwd)}`);
      es.addEventListener("snapshot", (evt) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse((evt as MessageEvent).data) as {
            sessions?: Array<{ id: string; source?: string; command?: string; title?: string; exited?: boolean }>;
          };
          for (const session of payload.sessions ?? []) ingest(session);
        } catch {
          // ignore
        }
      });
      es.addEventListener("upsert", (evt) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse((evt as MessageEvent).data) as {
            session?: { id: string; source?: string; command?: string; title?: string; exited?: boolean };
          };
          if (payload.session) ingest(payload.session);
        } catch {
          // ignore
        }
      });
      es.addEventListener("remove", (evt) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse((evt as MessageEvent).data) as { id?: string };
          if (!payload.id) return;
          const tabId = `agent-${payload.id}`;
          if (terminalTabsRef.current.some((tab) => tab.id === tabId)) {
            // Session already destroyed server-side — just drop the tab.
            closeTerminalSession(tabId, { kill: false });
          } else {
            knownAgentPtyIdsRef.current.delete(payload.id);
          }
        } catch {
          // ignore
        }
      });
    } catch {
      // EventSource unavailable
    }

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [closeTerminalSession, terminalWatchCwd, upsertAgentTerminalSession]);

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
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
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
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--bg-selected) 70%, var(--bg-panel));
          box-shadow: 0 18px 44px color-mix(in oklab, var(--text) 12%, transparent);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: var(--shadow-md);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
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
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        }}
      >
        {sidebarContent}
      </div>

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        <div
          ref={topBarRef}
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
              title={sidebarOpen ? t("shell.hideSidebar") : t("shell.showSidebar")}
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
              title={t("shell.settings")}
              aria-label={t("shell.settings")}
            >
              <Icon icon={Settings} size={16} strokeWidth={2} />
            </button>
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
              <TopBarChromeWidgets />
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                compact={isMobile}
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession
              />
              <button
                type="button"
                ref={systemBtnRef}
                className={`chrome-btn${activeTopPanel === "system" ? " is-active" : ""}`}
                onClick={() => toggleTopPanel("system")}
                title={t("shell.systemPrompt")}
                aria-label={t("shell.systemPrompt")}
                aria-pressed={activeTopPanel === "system"}
                style={activeTopPanel === "system" ? { boxShadow: "inset 0 -2px 0 0 var(--accent)" } : undefined}
              >
                <Icon
                  icon={FileText}
                  size={12}
                  strokeWidth={2}
                  style={{ color: systemPrompt ? "var(--text)" : "var(--text-dim)", flexShrink: 0 }}
                />
                {!isMobile && <span>{t("shell.system")}</span>}
              </button>
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
              title={rightPanelOpen ? t("shell.hideFilePanel") : t("shell.showFilePanel")}
              aria-label={rightPanelOpen ? t("shell.hideFilePanel") : t("shell.showFilePanel")}
              style={{ flexShrink: 0 }}
            >
              <Icon icon={PanelRight} size={16} strokeWidth={1.8} />
            </button>
          </div>
          {/* Custom Windows/Linux caption buttons — only when this bar is rightmost. */}
          {!rightPanelOpen && <WindowControls />}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("shell.systemPromptEmpty")}
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("shell.systemPromptLoad")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
              key={sessionKey}
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
          ["--right-panel-width" as string]: `${rightPanelWidth}px`,
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
                  {tab.kind === "terminal" && terminalTabs.length > 0 && (
                    <span className="right-workspace-tab-count">{terminalTabs.length}</span>
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
                focusPath={gitFocusPath}
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
            {/* Terminal subtabs — same strip language as Files (icon-only when narrow) */}
            <div className="file-subtabs titlebar-no-drag">
              {terminalTabs.map((tab) => {
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
              {terminalTabs.length === 0 ? (
                <div style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "var(--text-dim)",
                  fontSize: 12,
                }}>
                  <span>{t("git.terminal")}</span>
                  <button type="button" className="chrome-btn" onClick={addTerminalSession}>
                    {t("git.newTerminal")}
                  </button>
                </div>
              ) : (
                terminalTabs.map((tab) => {
                  if (!mountedTerminalIds.includes(tab.id)) return null;
                  const active = tab.id === activeTerminalTabId;
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
                        cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
                        attachSessionId={tab.attachSessionId ?? null}
                        sourceLabel={tab.source === "agent" ? tab.label : null}
                      />
                    </div>
                  );
                })
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
        onModelsChanged={() => setModelsRefreshKey((k) => k + 1)}
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
    </>
  );
}
