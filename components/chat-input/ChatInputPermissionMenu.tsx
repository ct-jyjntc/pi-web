"use client";

import React from "react";
import { Check } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import { PERMISSION_MODES, type PermissionMode } from "./chat-input-shared";

export type ChatInputPermissionMenuProps = {
  style: React.CSSProperties;
  permissionMode: PermissionMode;
  applyPermissionMode: (mode: PermissionMode) => void;
};

export function ChatInputPermissionMenu({
  style,
  permissionMode,
  applyPermissionMode,
}: ChatInputPermissionMenuProps) {
  const { t } = useLocale();
  return (
    <div className="menu-card" style={style}>
      {PERMISSION_MODES.map((mode) => {
        const isActive = permissionMode === mode;
        const title = mode === "full" ? t("chat.permissionFull") : t("chat.permissionAsk");
        const desc = mode === "full" ? t("chat.permissionFullDesc") : t("chat.permissionAskDesc");
        return (
          <button
            key={mode}
            onClick={() => void applyPermissionMode(mode)}
            style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              width: "100%", padding: "9px 12px",
              background: isActive ? "var(--bg-selected)" : "none",
              border: "none",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", fontSize: 12, textAlign: "left",
              fontWeight: isActive ? 600 : 400,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
          >
            {isActive
              ? <Icon icon={Check} size={10} strokeWidth={2} style={{ flexShrink: 0, marginTop: 3, color: "var(--accent)" }} />
              : <span style={{ width: 10, flexShrink: 0 }} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", color: mode === "full" ? "var(--destructive)" : "inherit" }}>{title}</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", marginTop: 2, fontWeight: 400 }}>{desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type PermissionErrorToastProps = {
  bottom: React.CSSProperties["bottom"];
  right: React.CSSProperties["right"];
  permissionError: string;
};

export function PermissionErrorToast({ bottom, right, permissionError }: PermissionErrorToastProps) {
  const { t } = useLocale();
  return (
    <div role="alert" style={{
      position: "fixed",
      bottom,
      right,
      zIndex: 500,
      background: "var(--bg-panel)", color: "var(--destructive)",
      fontSize: 11, padding: "4px 8px", borderRadius: "var(--radius-sm)",
      maxWidth: "min(420px, 80vw)", overflowWrap: "break-word",
      border: "1px solid color-mix(in oklab, var(--destructive) 28%, var(--border))",
      boxShadow: "var(--shadow-md)",
    }}>
      {t("chat.permissionChangeFailed")}: {permissionError}
    </div>
  );
}
