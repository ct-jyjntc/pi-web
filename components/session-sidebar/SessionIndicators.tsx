"use client";

import { useLocale } from "@/hooks/useLocale";

export function RunningSessionIndicator() {
  const { t } = useLocale();
  return (
    <span
      title={t("sidebar.agentRunningEllipsis")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg className="session-running-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 12a9 9 0 1 1-3.8-7.4"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function UnreadSessionIndicator() {
  const { t } = useLocale();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--text)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

