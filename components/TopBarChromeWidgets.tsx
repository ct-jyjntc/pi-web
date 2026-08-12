"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Bot, ListTodo } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  chromeWidgetFocus,
  chromeWidgetSummary,
  classifyWidgetKey,
  parseWidget,
} from "@/lib/extension-widgets";
import { ChromeWidgetPopover, CHROME_WIDGET_POPOVER_WIDTH } from "./extension/ChromeWidgetPopover";
import { useChromeWidgetsMetric } from "@/lib/session-metrics-store";
import { Icon } from "./Icon";

const CAPSULE_STYLE: CSSProperties = {
  display: "inline-flex",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  height: 24,
  minHeight: 24,
  maxHeight: 24,
  padding: "0 8px",
  margin: "auto 0",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  background: "transparent",
  color: "var(--text-muted)",
  font: "inherit",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 500,
  lineHeight: 1,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
  boxSizing: "border-box",
};

function capsuleCount(key: string, lines: string[]): string {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "todo") {
    if (parsed.total > 0) return `${parsed.completed}/${parsed.total}`;
    return "0";
  }
  if (parsed.kind === "agents") {
    return String(Math.max(0, parsed.agentCount));
  }
  return String(Math.max(1, lines.filter((l) => l.trim()).length));
}

function isCapsuleActive(key: string, lines: string[]): boolean {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "todo") {
    return parsed.items.some((i) => i.status === "in_progress")
      || (parsed.total > 0 && parsed.completed < parsed.total);
  }
  if (parsed.kind === "agents") {
    return parsed.runningCount + parsed.queuedCount > 0;
  }
  return false;
}

/**
 * Option B: minimal status capsules in the app top bar.
 * Layout is inline-styled so it survives CSS HMR / turbopack lag.
 */
export function TopBarChromeWidgets() {
  const { t } = useLocale();
  const widgets = useChromeWidgetsMetric();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const popoverRef = useRef<HTMLDivElement>(null);

  const openWidget = widgets.find((w) => w.key === openKey) ?? null;

  const placePopover = useCallback((key: string) => {
    const btn = btnRefs.current.get(key);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - CHROME_WIDGET_POPOVER_WIDTH - 8,
    );
    setPopoverPos({ top: rect.bottom + 6, left });
  }, []);

  const toggle = useCallback((key: string) => {
    setOpenKey((cur) => {
      if (cur === key) return null;
      requestAnimationFrame(() => placePopover(key));
      return key;
    });
  }, [placePopover]);

  useLayoutEffect(() => {
    if (!openKey) {
      setPopoverPos(null);
      return;
    }
    placePopover(openKey);
  }, [openKey, placePopover, widgets]);

  useEffect(() => {
    if (!openKey) return;
    if (!widgets.some((w) => w.key === openKey)) {
      setOpenKey(null);
      return;
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      const btn = btnRefs.current.get(openKey);
      if (btn?.contains(target)) return;
      setOpenKey(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey, widgets]);

  if (widgets.length === 0) return null;

  return (
    <>
      <div
        className="titlebar-no-drag"
        data-slot="topbar-status-capsules"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "center",
          gap: 4,
          height: "100%",
          padding: "0 6px",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        {widgets.map((widget) => {
          const kind = classifyWidgetKey(widget.key);
          const title = kind === "todo" ? t("ext.todo") : kind === "agents" ? t("ext.agents") : widget.key;
          const count = capsuleCount(widget.key, widget.lines);
          const focus = chromeWidgetFocus(widget.key, widget.lines);
          const summary = chromeWidgetSummary(widget.key, widget.lines);
          const live = isCapsuleActive(widget.key, widget.lines);
          const open = openKey === widget.key;
          const accent = kind === "todo" ? "var(--accent)" : "var(--success)";

          return (
            <button
              key={widget.key}
              ref={(el) => {
                if (el) btnRefs.current.set(widget.key, el);
                else btnRefs.current.delete(widget.key);
              }}
              type="button"
              onClick={() => toggle(widget.key)}
              title={summary ? `${title}: ${summary}` : title}
              aria-label={summary ? `${title}: ${summary}` : `${title} ${count}`}
              aria-expanded={open}
              aria-haspopup="dialog"
              style={{
                ...CAPSULE_STYLE,
                color: open ? "var(--text)" : "var(--text-muted)",
                background: open ? "var(--bg-selected)" : "transparent",
                borderColor: open
                  ? `color-mix(in oklab, ${accent} 35%, var(--border))`
                  : "var(--border)",
              }}
            >
              <span
                aria-hidden
                className={live ? "tool-run-live" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  color: accent,
                  flexShrink: 0,
                  lineHeight: 0,
                }}
              >
                {kind === "todo" ? (
                  <Icon icon={ListTodo} size={13} strokeWidth={1.8} style={{ display: "block", flexShrink: 0 }} />
                ) : (
                  <Icon icon={Bot} size={13} strokeWidth={1.8} style={{ display: "block", flexShrink: 0 }} />
                )}
              </span>
              <span
                style={{
                  display: "inline-block",
                  letterSpacing: "0.01em",
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                {count}
              </span>
              {focus ? (
                <span
                  className="topbar-capsule-focus"
                  style={{
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text-muted)",
                    fontWeight: 400,
                  }}
                >
                  {focus}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />

      {openWidget && popoverPos && (
        <ChromeWidgetPopover
          widget={openWidget}
          pos={popoverPos}
          popoverRef={popoverRef}
        />
      )}
    </>
  );
}
