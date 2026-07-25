/**
 * Session metrics store — keeps context usage / session stats updates out of
 * AppShell React state so streaming token ticks don't re-render the whole shell
 * (sidebar, git panel, file viewer, etc.).
 */
import { useSyncExternalStore } from "react";
import type { SessionStatsInfo } from "@/lib/pi-types";

export type ContextUsageInfo = {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
};

type MetricsSnapshot = {
  contextUsage: ContextUsageInfo | null;
  sessionStats: SessionStatsInfo | null;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: MetricsSnapshot = {
  contextUsage: null,
  sessionStats: null,
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

export function setContextUsageMetric(usage: ContextUsageInfo | null): void {
  if (snapshot.contextUsage === usage) return;
  // Cheap equality for the common case of identical values under a new object.
  const prev = snapshot.contextUsage;
  if (
    prev &&
    usage &&
    prev.percent === usage.percent &&
    prev.contextWindow === usage.contextWindow &&
    prev.tokens === usage.tokens
  ) {
    return;
  }
  if (!prev && !usage) return;
  snapshot = { ...snapshot, contextUsage: usage };
  emit();
}

export function setSessionStatsMetric(stats: SessionStatsInfo | null): void {
  if (snapshot.sessionStats === stats) return;
  snapshot = { ...snapshot, sessionStats: stats };
  emit();
}

export function clearSessionMetrics(): void {
  if (snapshot.contextUsage === null && snapshot.sessionStats === null) return;
  snapshot = { contextUsage: null, sessionStats: null };
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

export function useSessionStatsMetric(): SessionStatsInfo | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().sessionStats,
    () => null,
  );
}

export function getSessionStatsMetric(): SessionStatsInfo | null {
  return snapshot.sessionStats;
}

export function getContextUsageMetric(): ContextUsageInfo | null {
  return snapshot.contextUsage;
}
