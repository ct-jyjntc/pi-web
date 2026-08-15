/**
 * Right-rail scrollbar only — same width as the main chat rail, no minimap dots.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export function ChatScrollRail({
  scrollContainer,
}: {
  scrollContainer: RefObject<HTMLElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [metrics, setMetrics] = useState({ ratio: 0, viewport: 1, overflow: false });

  const update = useCallback(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = Math.max(0, el.scrollHeight - el.clientHeight);
    const viewport = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
    setMetrics({
      ratio: scrollable > 0 ? el.scrollTop / scrollable : 0,
      viewport: Math.min(1, Math.max(viewport, 0.08)),
      overflow: scrollable > 1,
    });
  }, [scrollContainer]);

  useEffect(() => {
    let cancelled = false;
    let el: HTMLElement | null = null;
    const observer = new ResizeObserver(update);
    const attach = () => {
      if (cancelled) return;
      el = scrollContainer.current;
      if (!el) {
        requestAnimationFrame(attach);
        return;
      }
      update();
      el.addEventListener("scroll", update, { passive: true });
      observer.observe(el);
    };
    attach();
    return () => {
      cancelled = true;
      if (el) el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollContainer, update]);

  const scrollToRatio = useCallback((viewportTopRatio: number) => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const span = 1 - metrics.viewport;
    const clamped = Math.max(0, Math.min(span, viewportTopRatio));
    el.scrollTop = span > 0 ? (clamped / span) * scrollable : 0;
  }, [metrics.viewport, scrollContainer]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!metrics.overflow) return;
    draggingRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickRatio = (event.clientY - rect.top) / rect.height;
    const grabOffset = clickRatio - metrics.ratio * (1 - metrics.viewport);
    const insideBox = grabOffset >= 0 && grabOffset <= metrics.viewport;
    const offset = insideBox ? grabOffset : metrics.viewport / 2;
    scrollToRatio(clickRatio - offset);
    const onMove = (move: MouseEvent) => {
      if (!draggingRef.current) return;
      scrollToRatio((move.clientY - rect.top) / rect.height - offset);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [metrics.overflow, metrics.ratio, metrics.viewport, scrollToRatio]);

  const thumbTop = metrics.ratio * (1 - metrics.viewport) * 100;
  const thumbHeight = metrics.viewport * 100;

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuenow={Math.round(metrics.ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: "100%",
        flex: 1,
        minHeight: 0,
        cursor: metrics.overflow ? "default" : "default",
        userSelect: "none",
      }}
    >
      {metrics.overflow ? (
        <div
          style={{
            position: "absolute",
            left: 4,
            right: 4,
            top: `${thumbTop}%`,
            height: `${Math.max(thumbHeight, 8)}%`,
            background: hovered
              ? "color-mix(in oklab, var(--text) 10%, transparent)"
              : "color-mix(in oklab, var(--text) 6%, transparent)",
            borderRadius: "var(--radius-xs)",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
