"use client";

import React from "react";
import { Check } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import { THINKING_LEVELS, THINKING_LEVEL_KEYS } from "./chat-input-shared";

export type ChatInputThinkingMenuProps = {
  style: React.CSSProperties;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  onThinkingLevelChange: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  setThinkingDropdownOpen: (open: boolean) => void;
};

export function ChatInputThinkingMenu({
  style,
  thinkingLevel,
  availableThinkingLevels,
  thinkingLevelMap,
  onThinkingLevelChange,
  setThinkingDropdownOpen,
}: ChatInputThinkingMenuProps) {
  const { t } = useLocale();
  const hasUserMap = !!(thinkingLevelMap && Object.keys(thinkingLevelMap).length > 0);

  return (
    <div className="menu-card" style={style}>
      {THINKING_LEVELS.filter((lvl) => {
        if (lvl === "auto") return true;
        // User/config map fully owns the picker — do not merge with SDK defaults.
        if (hasUserMap) {
          if (!(lvl in thinkingLevelMap!)) return false;
          return thinkingLevelMap![lvl] !== null;
        }
        if (!availableThinkingLevels) return true;
        return availableThinkingLevels.includes(lvl);
      }).map((lvl) => {
        const isActive = (thinkingLevel ?? "auto") === lvl;
        const label = t(THINKING_LEVEL_KEYS[lvl]);
        const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
        const showMapped = mappedVal != null && mappedVal !== "" && mappedVal !== lvl;
        return (
          <button
            key={lvl}
            onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "7px 12px",
              background: isActive ? "var(--bg-selected)" : "none",
              border: "none",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", fontSize: 12, textAlign: "left",
              fontWeight: isActive ? 600 : 400,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
          >
            {isActive
              ? <Icon icon={Check} size={10} strokeWidth={2} style={{ flexShrink: 0, color: "var(--accent)" }} />
              : <span style={{ width: 10, flexShrink: 0 }} />}
            <span style={{ flex: 1 }}>
              {label}
              {showMapped && (
                <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>
                  ({mappedVal})
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
