"use client";

import React from "react";
import { Check, DraftingCompass, Lock, LockOpen, Pencil, type LucideIcon } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AgentMode } from "@/lib/agent-mode";

export const AGENT_MODE_KEYS: Record<AgentMode, { label: MessageKey; desc: MessageKey }> = {
  ask: { label: "chat.modeAsk", desc: "chat.modeAskDesc" },
  auto: { label: "chat.modeAuto", desc: "chat.modeAutoDesc" },
  plan: { label: "chat.modePlan", desc: "chat.modePlanDesc" },
  yolo: { label: "chat.modeYolo", desc: "chat.modeYoloDesc" },
};

export const AGENT_MODE_ORDER: AgentMode[] = ["ask", "auto", "plan", "yolo"];

export function agentModeIcon(mode: AgentMode): LucideIcon {
  switch (mode) {
    case "ask":
      return Lock;
    case "auto":
      return Pencil;
    case "plan":
      return DraftingCompass;
    case "yolo":
      return LockOpen;
  }
}

export type ChatInputModeMenuProps = {
  style: React.CSSProperties;
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  width: "100%",
  padding: "6px 8px",
  border: "none",
   borderRadius: "var(--radius-sm)",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
};

export function ChatInputModeMenu({ style, mode, onModeChange }: ChatInputModeMenuProps) {
  const { t } = useLocale();
  return (
    <div
      className="menu-card"
      style={{
        ...style,
        display: "flex",
        flexDirection: "column",
        minWidth: 268,
        padding: 3,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {AGENT_MODE_ORDER.map((candidate) => {
        const isActive = mode === candidate;
        const { label, desc } = AGENT_MODE_KEYS[candidate];
        const IconComponent = agentModeIcon(candidate);
        const danger = candidate === "yolo";
        return (
          <button
            key={candidate}
            type="button"
            onClick={() => onModeChange(candidate)}
            style={ROW}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon
              icon={IconComponent}
              size={15}
              strokeWidth={1.8}
              style={{ flexShrink: 0, marginTop: 2, color: danger ? "var(--destructive)" : "var(--text-muted)" }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: danger ? "var(--destructive)" : "var(--text)",
                }}
              >
                {t(label)}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: danger ? "var(--destructive)" : "var(--text-dim)",
                  marginTop: 2,
                  fontWeight: 400,
                  lineHeight: 1.35,
                  opacity: danger ? 0.85 : 1,
                }}
              >
                {t(desc)}
              </span>
            </span>
            {isActive ? (
              <Icon
                icon={Check}
                size={14}
                strokeWidth={2}
                style={{ flexShrink: 0, marginTop: 2, color: danger ? "var(--destructive)" : "var(--text-muted)" }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
