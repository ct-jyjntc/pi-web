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

export function ChatInputModeMenu({ style, mode, onModeChange }: ChatInputModeMenuProps) {
  const { t } = useLocale();
  return (
    <div className="menu-card" style={style}>
      {AGENT_MODE_ORDER.map((candidate) => {
        const isActive = mode === candidate;
        const { label, desc } = AGENT_MODE_KEYS[candidate];
        const IconComponent = agentModeIcon(candidate);
        return (
          <button
            key={candidate}
            onClick={() => onModeChange(candidate)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              width: "100%",
              padding: "9px 12px",
              background: isActive ? "var(--bg-selected)" : "none",
              border: "none",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              fontWeight: isActive ? 600 : 400,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
          >
            {isActive
              ? <Icon icon={Check} size={10} strokeWidth={2} style={{ flexShrink: 0, marginTop: 3, color: "var(--accent)" }} />
              : <span style={{ width: 10, flexShrink: 0 }} />}
            <Icon icon={IconComponent} size={13} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", color: candidate === "yolo" ? "var(--destructive)" : "inherit" }}>{t(label)}</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", marginTop: 2, fontWeight: 400 }}>{t(desc)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
