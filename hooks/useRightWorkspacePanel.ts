/**
 * Right workspace panel: width persistence, drag-resize, file tabs, workspace tab ids.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Tab } from "@/components/TabBar";
import {
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_WIDTH_KEY,
} from "@/components/app-shell/app-shell-constants";
import { WORKSPACE_TABS, type WorkspaceTab } from "@/components/app-shell/terminal-tabs";
import { getFileName } from "@/lib/file-paths";

export function useRightWorkspacePanel(options: {
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
  selectedSessionId?: string | null;
}) {
  const { isMobile, setSidebarOpen, selectedSessionId } = options;

  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT);
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const rightPanelContainerRef = useRef<HTMLDivElement | null>(null);
  const rightPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const rightPanelDraggingRef = useRef(false);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  if (!rightPanelDraggingRef.current) rightPanelWidthRef.current = rightPanelWidth;

  const workspaceTabs: WorkspaceTab[] = WORKSPACE_TABS;
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string>("review");
  const [mountedWorkspaceTabIds, setMountedWorkspaceTabIds] = useState<string[]>([]);

  useEffect(() => {
    if (!rightPanelOpen) return;
    setMountedWorkspaceTabIds((prev) => (
      prev.includes(activeWorkspaceTabId) ? prev : [...prev, activeWorkspaceTabId]
    ));
  }, [activeWorkspaceTabId, rightPanelOpen]);

  // Load persisted width after mount (avoid SSR hydration mismatch)
  useEffect(() => {
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
      const delta = startX - ev.clientX;
      const max = Math.min(RIGHT_PANEL_MAX, Math.floor(window.innerWidth * 0.72));
      const next = Math.min(max, Math.max(RIGHT_PANEL_MIN, Math.round(startW + delta)));
      if (next === rightPanelWidthRef.current) return;
      rightPanelWidthRef.current = next;
      container?.style.setProperty("--right-panel-width", `${next}px`);
      handle.setAttribute("aria-valuenow", String(next));
    };

    const cleanup = () => {
      if (!rightPanelDraggingRef.current) return;
      rightPanelDraggingRef.current = false;
      setRightPanelResizing(false);
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
