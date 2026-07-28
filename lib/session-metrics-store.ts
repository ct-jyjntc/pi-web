/**
 * Session metrics store — keeps context usage / session stats / extension
 * status updates out of AppShell React state so streaming token ticks don't
 * re-render the whole shell (sidebar, git panel, file viewer, etc.).
 */
import { useSyncExternalStore } from "react";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ExtensionStatusItem } from "@/lib/types";

export type ContextUsageInfo = {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
};

type MetricsSnapshot = {
  contextUsage: ContextUsageInfo | null;
  sessionStats: SessionStatsInfo | null;
  extensionStatuses: ExtensionStatusItem[];
};

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: MetricsSnapshot = {
  contextUsage: null,
  sessionStats: null,
  extensionStatuses: [],
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
  a: ContextUsageInfo | null,
  b: ContextUsageInfo | null,
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

export function setContextUsageMetric(usage: ContextUsageInfo | null): void {
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

export function clearSessionMetrics(): void {
  if (
    snapshot.contextUsage === null
    && snapshot.sessionStats === null
    && snapshot.extensionStatuses.length === 0
  ) {
    return;
  }
  snapshot = { contextUsage: null, sessionStats: null, extensionStatuses: [] };
  emit();
}

export function useSessionMetrics(): MetricsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useContextUsageMetric(): ContextUsageInfo | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().contextUsage,
    () => null,
  );
}

export function getSessionStatsMetric(): SessionStatsInfo | null {
  return snapshot.sessionStats;
}
