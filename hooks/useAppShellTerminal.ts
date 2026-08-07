/**
 * Terminal workspace tabs for AppShell: user terminals + agent PTY discovery.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  renumberTerminalLabels,
  type TerminalSessionTab,
} from "@/components/app-shell/terminal-tabs";
import { apiFetch, apiStream, type ApiStream } from "@/lib/api-transport";

export type UseAppShellTerminalOptions = {
  // App locale `t` is MessageKey-typed; accept a wide callable.
  t: (key: string, params?: Record<string, string | number>) => string;
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setActiveWorkspaceTabId: (id: string) => void;
  /** Cwd to watch for agent-started PTY sessions (SSE). */
  terminalWatchCwd: string | null;
};

export function useAppShellTerminal({
  t,
  isMobile,
  setSidebarOpen,
  setRightPanelOpen,
  setActiveWorkspaceTabId,
  terminalWatchCwd,
}: UseAppShellTerminalOptions) {
  const terminalSeqRef = useRef(1);
  const [terminalTabs, setTerminalTabs] = useState<TerminalSessionTab[]>([]);
  const terminalTabsRef = useRef(terminalTabs);
  terminalTabsRef.current = terminalTabs;
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(null);
  const [mountedTerminalIds, setMountedTerminalIds] = useState<string[]>([]);
  const knownAgentPtyIdsRef = useRef(new Set<string>());

  const renumber = useCallback(
    (tabs: TerminalSessionTab[]) => renumberTerminalLabels(tabs, t),
    [t],
  );

  const addTerminalSession = useCallback(() => {
    const prev = terminalTabsRef.current;
    if (prev.filter((tab) => tab.source === "user").length === 0) terminalSeqRef.current = 1;
    const n = terminalSeqRef.current++;
    const id = `term-${n}`;
    const next = renumber([
      ...prev,
      { id, label: "", source: "user", cwd: terminalWatchCwd },
    ]);
    setTerminalTabs(next);
    setActiveTerminalTabId(id);
    setMountedTerminalIds((mounted) => (mounted.includes(id) ? mounted : [...mounted, id]));
    setActiveWorkspaceTabId("terminal");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, renumber, setActiveWorkspaceTabId, setRightPanelOpen, setSidebarOpen, terminalWatchCwd]);

  const closeTerminalSession = useCallback((tabId: string, options?: { kill?: boolean }) => {
    const kill = options?.kill !== false;
    const closing = terminalTabsRef.current.find((tab) => tab.id === tabId);
    if (closing?.source === "agent" && closing.attachSessionId) {
      knownAgentPtyIdsRef.current.delete(closing.attachSessionId);
      if (kill) {
        void apiFetch(`/api/cwd/pty/${closing.attachSessionId}`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
    }
    setTerminalTabs((prev) => {
      const next = renumber(prev.filter((tab) => tab.id !== tabId));
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
  }, [renumber]);

  /**
   * Tabs belonging to the current top-left workspace (for tab bar / counts).
   * Other workspaces' tabs stay mounted off-screen so remote PTYs keep running.
   */
  const visibleTerminalTabs = terminalWatchCwd
    ? terminalTabs.filter((tab) => !tab.cwd || tab.cwd === terminalWatchCwd)
    : terminalTabs;

  // When the workspace changes, point the active tab at something visible here —
  // never kill other workspaces' shells.
  useEffect(() => {
    if (visibleTerminalTabs.some((tab) => tab.id === activeTerminalTabId)) return;
    setActiveTerminalTabId(visibleTerminalTabs[0]?.id ?? null);
  }, [visibleTerminalTabs, activeTerminalTabId]);

  const upsertAgentTerminalSession = useCallback((session: {
    id: string;
    command?: string;
    title?: string;
    exited?: boolean;
  }) => {
    const tabId = `agent-${session.id}`;
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
        return renumber(prev.map((tab) => (
          tab.id === tabId
            ? { ...tab, command: session.command ?? session.title ?? tab.command }
            : tab
        )));
      }
      return renumber([
        ...prev,
        {
          id: tabId,
          label: "",
          source: "agent",
          attachSessionId: session.id,
          command: session.command ?? session.title,
          cwd: terminalWatchCwd,
        },
      ]);
    });
    setActiveTerminalTabId(tabId);
    setMountedTerminalIds((mounted) => (mounted.includes(tabId) ? mounted : [...mounted, tabId]));
    setActiveWorkspaceTabId("terminal");
    setRightPanelOpen(true);
  }, [closeTerminalSession, renumber, setActiveWorkspaceTabId, setRightPanelOpen, terminalWatchCwd]);

  useEffect(() => {
    if (!activeTerminalTabId) return;
    setMountedTerminalIds((prev) =>
      prev.includes(activeTerminalTabId) ? prev : [...prev, activeTerminalTabId],
    );
  }, [activeTerminalTabId]);

  // Discover AI-started PTY sessions and surface them in the Terminal workspace.
  useEffect(() => {
    if (!terminalWatchCwd) return;
    let es: ApiStream | null = null;
    let cancelled = false;

    const ingest = (session: {
      id?: string;
      source?: string;
      command?: string;
      title?: string;
      exited?: boolean;
    }) => {
      if (!session.id || session.source !== "agent") return;
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
      es = apiStream(`/api/cwd/pty/events?cwd=${encodeURIComponent(terminalWatchCwd)}`);
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

  return {
    terminalTabs,
    visibleTerminalTabs,
    activeTerminalTabId,
    setActiveTerminalTabId,
    mountedTerminalIds,
    addTerminalSession,
    closeTerminalSession,
    upsertAgentTerminalSession,
  };
}
