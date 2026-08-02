"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import { formatThoughtDuration } from "@/lib/message-display";
import { findVerticalScrollParent } from "./chat-window-helpers";

export function ProcessDetailsGroup({
  durationSeconds,
  toolCallCount,
  children,
  onEscapeStickToBottom,
}: {
  durationSeconds?: number;
  toolCallCount: number;
  children: ReactNode;
  /** Detach stick-to-bottom lock before height changes (required when user is at bottom). */
  onEscapeStickToBottom?: () => void;
}) {
  const { t } = useLocale();
  // null = no explicit user toggle yet → default collapsed when settled.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? false;
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** Viewport Y of the toggle captured just before open flips — used to pin it. */
  const pinTopRef = useRef<number | null>(null);

  let label = t("window.thought");
  if (durationSeconds != null && Number.isFinite(durationSeconds)) {
    if (durationSeconds < 1) label = t("window.thoughtBriefly");
    else label = t("window.thoughtFor", { duration: formatThoughtDuration(durationSeconds) });
  }

  const toggle = useCallback(() => {
    // Escape stick-to-bottom FIRST. Its ResizeObserver scrolls to bottom on
    // positive height change while isAtBottom — that is exactly the "expands
    // upward" bug at the page bottom. stopScroll sets isAtBottom=false
    // synchronously so the resize handler's scrollToBottom bails out.
    onEscapeStickToBottom?.();
    const btn = buttonRef.current;
    if (btn) pinTopRef.current = btn.getBoundingClientRect().top;
    setUserOpen((prev) => !(prev ?? false));
  }, [onEscapeStickToBottom]);

  useLayoutEffect(() => {
    const anchorTop = pinTopRef.current;
    const btn = buttonRef.current;
    if (anchorTop == null || !btn) return;
    pinTopRef.current = null;

    const pinButton = () => {
      const node = buttonRef.current;
      if (!node) return;
      const delta = node.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) < 0.5) return;
      const scroller = findVerticalScrollParent(node);
      if (scroller) scroller.scrollTop += delta;
    };

    // First fix after React commits the expanded/collapsed DOM.
    pinButton();
    // ResizeObserver + rAF-based scrollToBottom can still race; re-pin a few
    // frames so the toggle stays put even if something re-sticks late.
    let raf2 = 0;
    let raf3 = 0;
    const raf1 = requestAnimationFrame(() => {
      pinButton();
      raf2 = requestAnimationFrame(() => {
        pinButton();
        raf3 = requestAnimationFrame(pinButton);
      });
    });
    const t = window.setTimeout(pinButton, 32);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
      window.clearTimeout(t);
    };
  }, [open]);

  return (
    <div
      data-slot="process-details"
      style={{
        marginBottom: 12,
        color: "var(--text-muted)",
        fontSize: 12,
        lineHeight: 1.45,
        opacity: 0.78,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={open ? t("window.collapseProcess") : t("window.expandProcess")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "auto",
          maxWidth: "100%",
          minHeight: 22,
          padding: "1px 0",
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Icon
          icon={ChevronRight}
          size={10}
          strokeWidth={1.6}
          style={{
            flexShrink: 0,
            opacity: 0.55,
            // Collapsed: ▶  Expanded: ▼  (content always mounts below the button)
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
          {toolCallCount > 0 ? ` · ${t("window.toolCallsCount", { n: toolCallCount })}` : ""}
        </span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}


