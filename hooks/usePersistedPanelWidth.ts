/**
 * Drag-resizable panel width persisted in localStorage.
 * During a drag the CSS variable is written on the container; React commits on pointerup.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clampPanelWidth, panelWidthCap, parseStoredPanelWidth } from "@/lib/panel-width";

export function usePersistedPanelWidth(options: {
  storageKey: string;
  cssVar: string;
  minWidth: number;
  maxWidth: number;
  maxViewportFraction: number;
  /** +1 grows when dragging right (left sidebar); -1 grows when dragging left (right panel). */
  dragSign: 1 | -1;
  enabled: boolean;
  /** SSR-safe numeric default. Omit to let CSS own the width until hydrate/drag. */
  defaultWidth?: number;
}): {
  width: number | null;
  displayWidth: number;
  resizing: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  handleResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  cssVarStyle: CSSProperties;
} {
  const {
    storageKey,
    cssVar,
    minWidth,
    maxWidth,
    maxViewportFraction,
    dragSign,
    enabled,
    defaultWidth,
  } = options;

  const [width, setWidth] = useState<number | null>(defaultWidth ?? null);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const draggingRef = useRef(false);
  const skipPersistRef = useRef(true);
  const widthRef = useRef<number | null>(width);
  if (!draggingRef.current) widthRef.current = width;

  const capMax = useCallback(() => {
    const viewport = typeof window === "undefined" ? maxWidth : window.innerWidth;
    return panelWidthCap(maxWidth, viewport, maxViewportFraction);
  }, [maxWidth, maxViewportFraction]);

  const persist = useCallback((value: number) => {
    try {
      window.localStorage.setItem(storageKey, String(value));
    } catch {
      // ignore quota / private mode
    }
  }, [storageKey]);

  useEffect(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      const stored = parseStoredPanelWidth(window.localStorage.getItem(storageKey));
      if (stored == null) return;
      const next = clampPanelWidth(stored, minWidth, capMax());
      setWidth(next);
      document.documentElement.style.setProperty(cssVar, `${next}px`);
    } catch {
      // ignore
    }
  }, [capMax, cssVar, minWidth, storageKey]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    if (width == null) return;
    persist(width);
    document.documentElement.style.setProperty(cssVar, `${width}px`);
  }, [cssVar, persist, width]);

  useEffect(() => () => {
    const dragged = draggingRef.current ? widthRef.current : null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (dragged != null) persist(dragged);
  }, [persist]);

  const handleResizeStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();

    cleanupRef.current?.();

    const startX = e.clientX;
    const container = containerRef.current;
    const measured = container?.getBoundingClientRect().width;
    const startW = widthRef.current ?? (measured && measured > 0 ? Math.round(measured) : (defaultWidth ?? minWidth));
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    draggingRef.current = true;
    setResizing(true);

    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const next = clampPanelWidth(startW + dragSign * (ev.clientX - startX), minWidth, capMax());
      if (next === widthRef.current) return;
      widthRef.current = next;
      container?.style.setProperty(cssVar, `${next}px`);
      document.documentElement.style.setProperty(cssVar, `${next}px`);
      handle.setAttribute("aria-valuenow", String(next));
    };

    const cleanup = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setResizing(false);
      if (widthRef.current != null) setWidth(widthRef.current);
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
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };

    const onUp = (ev: Event) => {
      if (ev instanceof PointerEvent && ev.pointerId !== pointerId) return;
      cleanup();
    };

    cleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
  }, [capMax, cssVar, defaultWidth, dragSign, enabled, minWidth]);

  const displayWidth = width ?? defaultWidth ?? minWidth;
  const cssVarStyle = (width == null ? {} : { [cssVar]: `${width}px` }) as CSSProperties;

  return {
    width,
    displayWidth,
    resizing,
    containerRef,
    handleResizeStart,
    cssVarStyle,
  };
}
