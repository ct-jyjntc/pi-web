/**
 * Right workspace panel: width persistence, drag-resize, file tabs, workspace tab ids.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tab } from "@/components/TabBar";
import {
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_WIDTH_KEY,
} from "@/components/app-shell/app-shell-constants";
import { WORKSPACE_TABS, type WorkspaceTab } from "@/components/app-shell/terminal-tabs";
import { getFileName } from "@/lib/file-paths";
import { usePersistedPanelWidth } from "@/hooks/usePersistedPanelWidth";

export function useRightWorkspacePanel(options: {
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
  selectedSessionId?: string | null;
}) {
  const { isMobile, setSidebarOpen, selectedSessionId } = options;

  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const {
    displayWidth: rightPanelWidth,
    resizing: rightPanelResizing,
    containerRef: rightPanelContainerRef,
    handleResizeStart: handleRightPanelResizeStart,
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

  const workspaceTabs: WorkspaceTab[] = WORKSPACE_TABS;
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string>("review");
  const [mountedWorkspaceTabIds, setMountedWorkspaceTabIds] = useState<string[]>([]);

  useEffect(() => {
    if (!rightPanelOpen) return;
    setMountedWorkspaceTabIds((prev) => (
      prev.includes(activeWorkspaceTabId) ? prev : [...prev, activeWorkspaceTabId]
    ));
  }, [activeWorkspaceTabId, rightPanelOpen]);


  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    sourceSessionId?: string | null,
    focusLine?: number | null,
  ) => {
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
          focusLine: focusLine ?? t.focusLine ?? null,
        };
      });
    });
    setActiveFileTabId(tabId);
    setActiveWorkspaceTabId("files");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, setSidebarOpen]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSessionId ?? null);
  }, [handleOpenFile, selectedSessionId]);

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

  const clearFileTabs = useCallback(() => {
    setFileTabs([]);
    setActiveFileTabId(null);
  }, []);

  return {
    fileTabs,
    setFileTabs,
    activeFileTabId,
    setActiveFileTabId,
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelWidth,
    rightPanelResizing,
    rightPanelContainerRef,
    workspaceTabs,
    activeWorkspaceTabId,
    setActiveWorkspaceTabId,
    mountedWorkspaceTabIds,
    handleRightPanelResizeStart,
    handleOpenFile,
    handleOpenLinkedFile,
    handleCloseFileTab,
    clearFileTabs,
  };
}
