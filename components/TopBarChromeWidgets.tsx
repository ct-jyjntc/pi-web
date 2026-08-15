"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  classifyWidgetKey,
  parseWidget,
} from "@/lib/extension-widgets";
import { ChromeWidgetPopover, AGENTS_POPOVER_WIDTH, CHROME_WIDGET_POPOVER_WIDTH } from "./extension/ChromeWidgetPopover";
import { TodoItemRow } from "./extension/TodoAtoms";
import { useChromeWidgetsMetric, useTodosMetric, type ProjectionTodo } from "@/lib/session-metrics-store";
import { useWebSettings } from "@/lib/web-settings-store";
import { Icon } from "./Icon";

const TODO_KEY = "todos";

const TEXT_TRIGGER_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: "100%",
  padding: "0 8px",
  border: "none",
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 12,
  fontWeight: 400,
  lineHeight: "18px",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function capsuleCount(key: string, lines: string[]): number {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "agents") {
    return Math.max(0, parsed.agentCount);
  }
  return Math.max(1, lines.filter((l) => l.trim()).length);
}

function visibleTodos(todos: ProjectionTodo[] | null): ProjectionTodo[] {
  return (todos ?? []).filter((t) => t.status !== "deleted");
}

function TodoSubjectsPopover({
  todos,
  pos,
  popoverRef,
  title,
}: {
  todos: ProjectionTodo[];
  pos: { top: number; left: number };
  popoverRef: Ref<HTMLDivElement>;
  title: string;
}) {
  const { t } = useLocale();
  const completed = todos.filter((t) => t.status === "completed").length;
  return (
    <div
      ref={popoverRef}
      className="menu-card"
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        display: "flex",
        flexDirection: "column",
        width: CHROME_WIDGET_POPOVER_WIDTH,
        maxHeight: "min(42vh, 300px)",
        overflow: "hidden",
        zIndex: 520,
        borderRadius: "var(--radius-md)",
        padding: 3,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "4px 8px 2px",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}>
          {title}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: "var(--text-dim)",
          }}
        >
          {completed} / {todos.length}
        </span>
      </div>
      <div style={{ overflowY: "auto", minHeight: 0, padding: "0 2px 4px" }}>
        {todos.length === 0 ? (
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-dim)" }}>{t("ext.todoEmpty")}</div>
        ) : (
          todos.map((item) => (
            <TodoItemRow
              key={item.id}
              item={{
                id: String(item.id),
                text: item.subject,
                status: item.status === "in_progress" ? "in_progress" : item.status === "completed" ? "completed" : "pending",
                activeForm: item.activeForm,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Option B: minimal status capsules in the app top bar.
 * Layout is inline-styled so it survives CSS HMR / turbopack lag.
 * Todos come from host projections; chromeWidgets carry subagents only.
 */
export function TopBarChromeWidgets({ parentSessionId }: { parentSessionId?: string | null }) {
  const { t } = useLocale();
  const chromeWidgets = useChromeWidgetsMetric();
  const widgets = useMemo(
    () => chromeWidgets.filter((w) => classifyWidgetKey(w.key) !== "todo"),
    [chromeWidgets],
  );
  const rawTodos = useTodosMetric();
  const showTodos = useWebSettings()?.showTodos !== false;
  const todoItems = showTodos ? visibleTodos(rawTodos) : [];
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const popoverRef = useRef<HTMLDivElement>(null);

  const openWidget = widgets.find((w) => w.key === openKey) ?? null;
  const todoOpen = openKey === TODO_KEY && todoItems.length > 0;

  const placePopover = useCallback((key: string) => {
    const btn = btnRefs.current.get(key);
    if (!btn) return;
    const width = key === TODO_KEY ? CHROME_WIDGET_POPOVER_WIDTH : AGENTS_POPOVER_WIDTH;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - width - 8,
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
  }, [openKey, placePopover, widgets, todoItems.length]);

  useEffect(() => {
    if (!openKey) return;
    const openExists = openKey === TODO_KEY
      ? todoItems.length > 0
      : widgets.some((w) => w.key === openKey);
    if (!openExists) {
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
  }, [openKey, widgets, todoItems.length]);

  if (todoItems.length === 0 && widgets.length === 0) return null;

  const todoTitle = t("ext.todo");
  const todoLabel = t("ext.todoCount", { n: todoItems.length });

  return (
    <>
      <div
        className="titlebar-no-drag"
        data-slot="topbar-status-capsules"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "stretch",
          height: "100%",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        {todoItems.length > 0 ? (
          <button
            key={TODO_KEY}
            ref={(el) => {
              if (el) btnRefs.current.set(TODO_KEY, el);
              else btnRefs.current.delete(TODO_KEY);
            }}
            type="button"
            onClick={() => toggle(TODO_KEY)}
            title={todoLabel}
            aria-label={todoLabel}
            aria-expanded={todoOpen}
            aria-haspopup="dialog"
            style={{
              ...TEXT_TRIGGER_STYLE,
              background: todoOpen ? "var(--bg-hover)" : "transparent",
            }}
          >
            {todoLabel}
            <Icon
              icon={ChevronDown}
              size={12}
              strokeWidth={1.8}
              style={{
                flexShrink: 0,
                transform: todoOpen ? "rotate(180deg)" : undefined,
              }}
            />
          </button>
        ) : null}
        {todoItems.length > 0 && widgets.length > 0 ? (
          <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />
        ) : null}
        {widgets.map((widget) => {
          const kind = classifyWidgetKey(widget.key);
          const count = capsuleCount(widget.key, widget.lines);
          const label = kind === "agents"
            ? t("ext.agentsCount", { n: count })
            : `${widget.key} ${count}`;
          const open = openKey === widget.key;

          return (
            <button
              key={widget.key}
              ref={(el) => {
                if (el) btnRefs.current.set(widget.key, el);
                else btnRefs.current.delete(widget.key);
              }}
              type="button"
              onClick={() => toggle(widget.key)}
              title={label}
              aria-label={label}
              aria-expanded={open}
              aria-haspopup="dialog"
              style={{
                ...TEXT_TRIGGER_STYLE,
                background: open ? "var(--bg-hover)" : "transparent",
              }}
            >
              {label}
              <Icon
                icon={ChevronDown}
                size={12}
                strokeWidth={1.8}
                style={{
                  flexShrink: 0,
                  transform: open ? "rotate(180deg)" : undefined,
                }}
              />
            </button>
          );
        })}
      </div>

      {todoOpen && popoverPos && (
        <TodoSubjectsPopover
          todos={todoItems}
          pos={popoverPos}
          popoverRef={popoverRef}
          title={todoTitle}
        />
      )}
      {openWidget && popoverPos && (
        <ChromeWidgetPopover
          widget={openWidget}
          pos={popoverPos}
          popoverRef={popoverRef}
          parentSessionId={parentSessionId}
        />
      )}
    </>
  );
}
