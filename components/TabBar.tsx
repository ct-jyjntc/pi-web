"use client";

import { useLocale } from "@/hooks/useLocale";
import { getFileIcon } from "./FileIcons";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
  /** Optional 1-based line to scroll into view when the tab is shown. */
  focusLine?: number | null;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useLocale();

  return (
    <div className="file-subtabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            className={`file-subtab${isActive ? " is-active" : ""}`}
            title={tab.filePath || tab.label}
            aria-label={tab.label}
            aria-selected={isActive}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectTab(tab.id);
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
          >
            <span className="file-subtab-icon" aria-hidden>
              {getFileIcon(tab.label, 13)}
            </span>
            <span className="file-subtab-label">{tab.label}</span>
            <button
              type="button"
              className="file-subtab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title={t("tab.close")}
              aria-label={t("tab.closeNamed", { name: tab.label })}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
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
