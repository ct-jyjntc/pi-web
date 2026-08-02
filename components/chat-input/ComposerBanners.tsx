"use client";

import { AlertTriangle } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";

export function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  const { t } = useLocale();
  return (
    <div
      title={text}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        fontSize: 12,
        color: "var(--text-muted)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          padding: "1px 7px",
          borderRadius: "var(--radius-pill)",
          border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {kind === "steer" ? t("chat.badgeSteer") : t("chat.badgeFollowUp")}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] | null }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div
      role="status"
      style={{
        marginBottom: 8,
        padding: "7px 10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-subtle)",
        color: "var(--text-muted)",
        fontSize: 11,
        lineHeight: 1.45,
        fontFamily: "var(--font-mono)",
        whiteSpace: "pre-wrap",
      }}
    >
      {warnings.join("\n")}
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useLocale();
  if (!error) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        maxHeight: 120,
        marginBottom: 8,
        padding: "7px 10px",
        overflowY: "auto",
        border: "1px solid var(--destructive-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--destructive-bg)",
        color: "var(--destructive)",
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <Icon icon={AlertTriangle} size={13} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{t("chat.modelError")}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error}</div>
      </div>
    </div>
  );
}


