/**
 * Session metrics store — keeps context usage / session stats / extension
 * status updates out of AppShell React state so streaming token ticks don't
 * re-render the whole shell (sidebar, git panel, file viewer, etc.).
 */
import { useSyncExternalStore } from "react";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import type { ProjectionTodo } from "@/lib/session-projections";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";

export type { ProjectionTodo };

type MetricsSnapshot = {
  contextUsage: ContextUsage | null;
  sessionStats: SessionStatsInfo | null;
  extensionStatuses: ExtensionStatusItem[];
  /** Subagent chrome widgets for the app top bar (todos live in `todos`). */
  chromeWidgets: ExtensionWidgetItem[];
  todos: ProjectionTodo[] | null;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: MetricsSnapshot = {
  contextUsage: null,
  sessionStats: null,
  extensionStatuses: [],
  chromeWidgets: [],
  todos: null,
};

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MetricsSnapshot {
  return snapshot;
}

function sameContextUsage(
  a: ContextUsage | null,
  b: ContextUsage | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.percent === b.percent
    && a.contextWindow === b.contextWindow
    && a.tokens === b.tokens
  );
}

function sameExtensionStatuses(
  a: ExtensionStatusItem[],
  b: ExtensionStatusItem[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].text !== b[i].text) return false;
  }
  return true;
}

export function setContextUsageMetric(usage: ContextUsage | null): void {
  if (sameContextUsage(snapshot.contextUsage, usage)) return;
  snapshot = { ...snapshot, contextUsage: usage };
  emit();
}

export function setSessionStatsMetric(stats: SessionStatsInfo | null): void {
  if (snapshot.sessionStats === stats) return;
  snapshot = { ...snapshot, sessionStats: stats };
  emit();
}

export function setExtensionStatusesMetric(statuses: ExtensionStatusItem[]): void {
  const next = Array.isArray(statuses) ? statuses : [];
  if (sameExtensionStatuses(snapshot.extensionStatuses, next)) return;
  snapshot = { ...snapshot, extensionStatuses: next };
  emit();
}

function sameChromeWidgets(a: ExtensionWidgetItem[], b: ExtensionWidgetItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.key !== right.key || left.placement !== right.placement) return false;
    if (left.lines.length !== right.lines.length) return false;
    for (let j = 0; j < left.lines.length; j++) {
      if (left.lines[j] !== right.lines[j]) return false;
    }
  }
  return true;
}

/** Publish todo/subagent widgets for the app top bar (left of Generate Title). */
export function setChromeWidgetsMetric(widgets: ExtensionWidgetItem[]): void {
  const next = Array.isArray(widgets) ? widgets : [];
  if (sameChromeWidgets(snapshot.chromeWidgets, next)) return;
  snapshot = { ...snapshot, chromeWidgets: next };
  emit();
}

function sameTodos(a: ProjectionTodo[] | null, b: ProjectionTodo[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.id !== right.id || left.status !== right.status || left.subject !== right.subject) return false;
    if (left.activeForm !== right.activeForm) return false;
  }
  return true;
}

export function setTodosMetric(todos: ProjectionTodo[] | null): void {
  if (sameTodos(snapshot.todos, todos)) return;
  snapshot = { ...snapshot, todos };
  emit();
}

export function clearSessionMetrics(): void {
  if (
    snapshot.contextUsage === null
    && snapshot.sessionStats === null
    && snapshot.extensionStatuses.length === 0
    && snapshot.chromeWidgets.length === 0
    && snapshot.todos === null
  ) {
    return;
  }
  snapshot = {
    contextUsage: null,
    sessionStats: null,
    extensionStatuses: [],
    chromeWidgets: [],
    todos: null,
  };
  emit();
}

export function useSessionMetrics(): MetricsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useContextUsageMetric(): ContextUsage | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().contextUsage,
    () => null,
  );
}

export function useChromeWidgetsMetric(): ExtensionWidgetItem[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().chromeWidgets,
    () => [],
  );
}

export function useTodosMetric(): ProjectionTodo[] | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().todos,
    () => null,
  );
}

export function getSessionStatsMetric(): SessionStatsInfo | null {
  return snapshot.sessionStats;
}
