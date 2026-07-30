"use client";

import { useSessionMetrics } from "@/lib/session-metrics-store";

/**
 * Context-usage percentage shown on the always-mounted workspace tab strip.
 * Kept in its own leaf module so `ContextPanel` can be code-split — importing
 * the badge must not drag the whole panel into the entry chunk.
 */
export function ContextTabBadge() {
  const { contextUsage } = useSessionMetrics();
  const pct = contextUsage?.percent;
  if (pct == null) return null;
  return (
    <span
      className="right-workspace-tab-count"
      style={pct > 90 ? { color: "var(--destructive)" } : undefined}
    >
      {`${Math.round(pct)}%`}
    </span>
  );
}
