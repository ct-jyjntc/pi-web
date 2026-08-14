"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { Bot, ListTodo } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  chromeWidgetFocus,
  chromeWidgetSummary,
  classifyWidgetKey,
  parseWidget,
} from "@/lib/extension-widgets";
import { ChromeWidgetPopover, CHROME_WIDGET_POPOVER_WIDTH } from "./extension/ChromeWidgetPopover";
import { TodoItemRow } from "./extension/TodoAtoms";
import { useChromeWidgetsMetric, useTodosMetric, type ProjectionTodo } from "@/lib/session-metrics-store";
import { useWebSettings } from "@/lib/web-settings-store";
import { Icon } from "./Icon";

const TODO_KEY = "todos";

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
  if (parsed.kind === "agents") {
    return String(Math.max(0, parsed.agentCount));
  }
  return String(Math.max(1, lines.filter((l) => l.trim()).length));
}

function isCapsuleActive(key: string, lines: string[]): boolean {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "agents") {
    return parsed.runningCount + parsed.queuedCount > 0;
  }
  return false;
}

function visibleTodos(todos: ProjectionTodo[] | null): ProjectionTodo[] {
  return (todos ?? []).filter((t) => t.status !== "deleted");
}

function todoFocus(todos: ProjectionTodo[]): string {
  const active = todos.find((t) => t.status === "in_progress");
  if (active) return active.activeForm?.trim() || active.subject;
  return todos.find((t) => t.status === "pending")?.subject ?? "";
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
export function TopBarChromeWidgets() {
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

  const completed = todoItems.filter((t) => t.status === "completed").length;
  const todoCount = `${completed}/${todoItems.length}`;
  const todoFocusText = todoFocus(todoItems);
  const todoLive = todoItems.some((t) => t.status === "in_progress") || completed < todoItems.length;
  const todoTitle = t("ext.todo");
  const todoSummary = todoFocusText ? `${todoCount} · ${todoFocusText}` : todoCount;

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
        {todoItems.length > 0 ? (
          <button
            key={TODO_KEY}
            ref={(el) => {
              if (el) btnRefs.current.set(TODO_KEY, el);
              else btnRefs.current.delete(TODO_KEY);
            }}
            type="button"
            onClick={() => toggle(TODO_KEY)}
            title={`${todoTitle}: ${todoSummary}`}
            aria-label={`${todoTitle}: ${todoSummary}`}
            aria-expanded={todoOpen}
            aria-haspopup="dialog"
            style={{
              ...CAPSULE_STYLE,
              color: todoOpen ? "var(--text)" : "var(--text-muted)",
              background: todoOpen ? "var(--bg-selected)" : "transparent",
              borderColor: todoOpen
                ? "color-mix(in oklab, var(--accent) 35%, var(--border))"
                : "var(--border)",
            }}
          >
            <span
              aria-hidden
              className={todoLive ? "tool-run-live" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                color: "var(--accent)",
                flexShrink: 0,
                lineHeight: 0,
              }}
            >
              <Icon icon={ListTodo} size={13} strokeWidth={1.8} style={{ display: "block", flexShrink: 0 }} />
            </span>
            <span style={{ display: "inline-block", letterSpacing: "0.01em", flexShrink: 0, lineHeight: 1 }}>
              {todoCount}
            </span>
            {todoFocusText ? (
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
                {todoFocusText}
              </span>
            ) : null}
          </button>
        ) : null}
        {widgets.map((widget) => {
          const kind = classifyWidgetKey(widget.key);
          const title = kind === "agents" ? t("ext.agents") : widget.key;
          const count = capsuleCount(widget.key, widget.lines);
          const focus = chromeWidgetFocus(widget.key, widget.lines);
          const summary = chromeWidgetSummary(widget.key, widget.lines);
          const live = isCapsuleActive(widget.key, widget.lines);
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
              title={summary ? `${title}: ${summary}` : title}
              aria-label={summary ? `${title}: ${summary}` : `${title} ${count}`}
              aria-expanded={open}
              aria-haspopup="dialog"
              style={{
                ...CAPSULE_STYLE,
                color: open ? "var(--text)" : "var(--text-muted)",
                background: open ? "var(--bg-selected)" : "transparent",
                borderColor: open
                  ? "color-mix(in oklab, var(--success) 35%, var(--border))"
                  : "var(--border)",
              }}
            >
              <span
                aria-hidden
                className={live ? "tool-run-live" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  color: "var(--success)",
                  flexShrink: 0,
                  lineHeight: 0,
                }}
              >
                <Icon icon={Bot} size={13} strokeWidth={1.8} style={{ display: "block", flexShrink: 0 }} />
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
        />
      )}
    </>
  );
}
