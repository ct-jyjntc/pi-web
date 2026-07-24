"use client";

import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { getFileIcon } from "./FileIcons";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useLocale();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  return (
    <div
      className="file-subtabs"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 32,
        borderBottom: "1px solid var(--border)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`file-subtab${isActive ? " is-active" : ""}`}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              height: "100%",
              padding: "0 8px 0 10px",
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "transparent",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 72,
              flexShrink: 0,
              userSelect: "none",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "inline-flex", alignItems: "center" }}>
              {getFileIcon(tab.label, 13)}
            </span>
            <span
              className="file-subtab-label"
              title={tab.filePath}
              style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}
            >
              {tab.label}
            </span>
            <button
              type="button"
              className="file-subtab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                padding: 0,
                border: "none",
                borderRadius: "var(--radius-xs)",
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
              title={t("tab.close")}
              aria-label={t("tab.closeNamed", { name: tab.label })}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{ display: "block" }}>
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
