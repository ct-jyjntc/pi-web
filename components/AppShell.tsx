"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { GitPanel } from "./GitPanel";
import { TerminalPanel } from "./TerminalPanel";
import { TabBar, type Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { BranchNavigator } from "./BranchNavigator";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import { ContextPanel, ContextTabBadge } from "./ContextPanel";
import { getSessionStatsMetric, setSessionStatsMetric } from "@/lib/session-metrics-store";

type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { isDark, toggleTheme } = useTheme();
  const { t, locale, toggleLocale } = useLocale();
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
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
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
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;

  useEffect(() => {
    return () => {
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system") => {
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
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;
  const rightPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  /** Right workspace: review + files + context + optional terminals */
  type WorkspaceTab =
    | { id: "review"; kind: "review" }
    | { id: "files"; kind: "files" }
    | { id: "context"; kind: "context" }
    | { id: string; kind: "terminal"; label: string };
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([
    { id: "review", kind: "review" },
    { id: "files", kind: "files" },
    { id: "context", kind: "context" },
  ]);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string>("review");
  const [gitFocusPath, setGitFocusPath] = useState<string | null>(null);
  const terminalSeqRef = useRef(1);

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
    // that lives in another worktree) must not close the open session.
    const newProject = projectRoot ?? cwd;
    if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === newProject) {
      return;
    }
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
  }, [router, selectedSession]);

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
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      // Patch metrics store name so Context panel stays in sync.
      const currentStats = getSessionStatsMetric();
      if (currentStats?.sessionId === sessionId) {
        setSessionStatsMetric({ ...currentStats, sessionName: title });
      }
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

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

  const handleOpenFile = useCallback((filePath: string, fileName: string, sourceSessionId?: string | null) => {
    // Files opened from the explorer go into the Files workspace tab.
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId }];
      if (!sourceSessionId || existing.sourceSessionId === sourceSessionId) return prev;
      return prev.map((t) => t.id === tabId ? { ...t, sourceSessionId } : t);
    });
    setActiveFileTabId(tabId);
    setActiveWorkspaceTabId("files");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const addTerminalTab = useCallback(() => {
    const n = terminalSeqRef.current++;
    const id = `terminal-${n}`;
    setWorkspaceTabs((prev) => [...prev, { id, kind: "terminal", label: `${t("git.terminal")} ${n}` }]);
    setActiveWorkspaceTabId(id);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, t]);

  const closeWorkspaceTab = useCallback((tabId: string) => {
    if (tabId === "review" || tabId === "files") return;
    setWorkspaceTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    setActiveWorkspaceTabId((cur) => (cur === tabId ? "review" : cur));
  }, []);

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
    rightPanelResizeCleanupRef.current?.();
    rightPanelResizeCleanupRef.current = null;
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
    const pointerId = e.pointerId;
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
      rightPanelWidthRef.current = next;
      setRightPanelWidth(next);
    };

    const cleanup = () => {
      setRightPanelResizing(false);
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
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onExplorerRefresh={handleExplorerRefresh}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
      />
      <div className="chrome-footer">
        <button
          type="button"
          className="chrome-btn"
          onClick={() => setModelsConfigOpen(true)}
          title={t("shell.models")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
          <span>{t("shell.models")}</span>
        </button>
        <div className="chrome-divider" aria-hidden />
        <button
          type="button"
          className="chrome-btn"
          onClick={() => setSkillsConfigOpen(true)}
          disabled={!activeCwd && !selectedSession?.cwd && !newSessionCwd}
          title={t("shell.skills")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span>{t("shell.skills")}</span>
        </button>
      </div>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="chrome-btn is-icon"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              }}
              title={isDark ? t("shell.switchToLight") : t("shell.switchToDark")}
              aria-label={isDark ? t("shell.switchToLight") : t("shell.switchToDark")}
              aria-pressed={isDark}
            >
              {isDark ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="chrome-btn"
              onClick={toggleLocale}
              title={`${t("shell.language")}: ${locale === "zh" ? t("shell.switchToEn") : t("shell.switchToZh")}`}
              aria-label={`${t("shell.language")}: ${locale === "zh" ? t("shell.switchToEn") : t("shell.switchToZh")}`}
              style={{ minWidth: 44, fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" }}
            >
              <span style={{ opacity: locale === "en" ? 1 : 0.45 }}>EN</span>
              <span style={{ opacity: 0.35 }}>/</span>
              <span style={{ opacity: locale === "zh" ? 1 : 0.45 }}>中</span>
            </button>
          </div>
          <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />
          {/* Middle: drag + chat actions + stats — may collapse when narrow */}
          <div className="app-topbar-middle titlebar-drag">
          <div className="titlebar-drag" style={{ flex: 1, minWidth: 8, height: "100%" }} aria-hidden />
          {showChat && (
            <div className="chrome-cluster titlebar-no-drag app-topbar-actions">
              {(() => {
                const hasMessages = Boolean(
                  selectedSession
                  && ((getSessionStatsMetric()?.userMessages ?? selectedSession.messageCount) > 0),
                );
                const disabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
                const isSuccess = autoNameStatus.kind === "success";
                const isError = autoNameStatus.kind === "error";
                const label = autoNameStatus.kind === "naming"
                  ? t("shell.generating")
                  : isSuccess
                    ? t("shell.titleUpdated")
                    : isError
                      ? t("shell.generationFailed")
                      : t("shell.generateTitle");
                const title = !selectedSession
                  ? t("shell.titleAfterSave")
                  : !hasMessages
                    ? t("shell.titleNeedMessage")
                    : isError
                      ? autoNameStatus.message
                      : t("shell.titleGenerate");

                return (
                  <button
                    type="button"
                    className={`chrome-btn${isError ? " is-danger" : isSuccess ? " is-success" : ""}`}
                    onClick={() => void handleAutoName()}
                    disabled={disabled}
                    title={title}
                    aria-label={label}
                  >
                    {autoNameStatus.kind === "naming" ? (
                      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : isSuccess ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m15 4 5 5L7 22l-5-5Z" />
                        <path d="m14 5 5 5" />
                        <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                      </svg>
                    )}
                    {!isMobile && <span>{label}</span>}
                  </button>
                );
              })()}
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--text)" : "var(--text-dim)", flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="13" y2="17" />
                </svg>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          </div>
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
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
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
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("shell.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("shell.step1")}<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{t("shell.step2a")} <strong style={{ color: "var(--text)" }}>{t("shell.models")}</strong> {t("shell.step2b")}
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
        {/* Workspace tabs: Review + Files + terminals + add */}
        <div className="app-topbar titlebar-drag desktop-top-chrome" style={{ display: "flex", flexDirection: "row", alignItems: "stretch", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: "var(--titlebar-height)" }}>
          <div
            className="titlebar-no-drag right-workspace-tabs"
            style={{ display: "flex", flexDirection: "row", alignItems: "stretch", flex: 1, minWidth: 0, overflow: "hidden" }}
          >
            {workspaceTabs.map((tab) => {
              const active = tab.id === activeWorkspaceTabId;
              const label =
                tab.kind === "review" ? t("git.review")
                  : tab.kind === "files" ? t("git.files")
                    : tab.kind === "context" ? t("shell.contextTab")
                      : tab.label;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`right-workspace-tab${active ? " is-active" : ""}`}
                  onClick={() => setActiveWorkspaceTabId(tab.id)}
                  style={{
                    display: "inline-flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    height: "100%",
                    padding: "0 10px 0 12px",
                    border: "none",
                    borderRight: "1px solid var(--border)",
                    background: active ? "var(--bg)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 12,
                    fontWeight: active ? 500 : 400,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    maxWidth: 160,
                  }}
                >
                  {tab.kind === "review" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0, opacity: 0.75 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                  ) : tab.kind === "files" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0, opacity: 0.75 }}>
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ) : tab.kind === "context" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0, opacity: 0.75 }}>
                      <path d="M3 20V10a9 9 0 0 1 18 0v10" /><line x1="3" y1="20" x2="21" y2="20" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0, opacity: 0.75 }}>
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  )}
                  <span className="right-workspace-tab-label" style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{label}</span>
                  {tab.kind === "context" && <ContextTabBadge />}
                  {tab.kind === "files" && fileTabs.length > 0 && (
                    <span
                      className="right-workspace-tab-count"
                      style={{
                        fontSize: 10,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--text-dim)",
                        background: "var(--bg-subtle)",
                        borderRadius: "var(--radius-pill)",
                        padding: "0 6px",
                        minWidth: 16,
                        textAlign: "center",
                        lineHeight: "16px",
                        flexShrink: 0,
                      }}
                    >
                      {fileTabs.length}
                    </span>
                  )}
                  {tab.kind === "terminal" && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="file-subtab-close"
                      onClick={(e) => { e.stopPropagation(); closeWorkspaceTab(tab.id); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          closeWorkspaceTab(tab.id);
                        }
                      }}
                      title={t("tab.close")}
                      aria-label={t("tab.close")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        borderRadius: "var(--radius-xs)",
                        color: "var(--text-dim)",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ display: "block" }}>
                        <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              className="chrome-btn is-icon right-workspace-add"
              onClick={addTerminalTab}
              title={t("git.newTerminal")}
              aria-label={t("git.newTerminal")}
              style={{ width: 36, minWidth: 36, height: "100%", minHeight: 0, borderRadius: 0, borderRight: "1px solid var(--border)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ display: "block" }}>
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <div className="titlebar-drag" style={{ flex: 1, height: "100%" }} aria-hidden />
          </div>
        </div>

        <div style={{ flex: 1, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column" }}>
          {activeWorkspaceTabId === "review" ? (
            <GitPanel
              cwd={activeCwd}
              refreshKey={explorerRefreshKey}
              focusPath={gitFocusPath}
              defaultExpanded
              onOpenFile={(filePath, fileName) => {
                // From review: open the file in the Files tab for full source view.
                handleOpenFile(filePath, fileName);
              }}
            />
          ) : activeWorkspaceTabId === "files" ? (
            <>
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
                    gitRefreshKey={explorerRefreshKey}
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
            </>
          ) : activeWorkspaceTabId === "context" ? (
            <ContextPanel />
          ) : (
            <TerminalPanel
              key={activeWorkspaceTabId}
              cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
            />
          )}
        </div>
      </div>
    </div>
    {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
    {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <SkillsConfig cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setSkillsConfigOpen(false)} />
    )}
    </>
  );
}
