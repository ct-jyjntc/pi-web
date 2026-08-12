"use client";

import React from "react";
import { Check } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import type { ModelOption } from "./chat-input-shared";

export type ChatInputModelMenuProps = {
  isMobile: boolean;
  modelDropdownRect: { top: number; left: number; width: number };
  showModelFilter: boolean;
  modelFilter: string;
  setModelFilter: (v: string) => void;
  setModelDropdownOpen: (v: boolean) => void;
  modelsByProvider: { provider: string; options: ModelOption[] }[];
  model: { provider: string; modelId: string } | null | undefined;
  isAutoModelSelection?: boolean;
  onModelChange: (provider: string, modelId: string) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
};

export function ChatInputModelMenu({
  isMobile,
  modelDropdownRect,
  showModelFilter,
  modelFilter,
  setModelFilter,
  setModelDropdownOpen,
  modelsByProvider,
  model,
  isAutoModelSelection,
  onModelChange,
  panelRef,
}: ChatInputModelMenuProps) {
  const { t } = useLocale();
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const bottom = viewportHeight - modelDropdownRect.top + 6;
  const maxH = Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6));
  // On mobile, pin to a small left margin and cap width to the
  // viewport so long model names never push the panel off-screen.
  const panelPos: React.CSSProperties = isMobile
    ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
    : { left: modelDropdownRect.left, width: "max-content", minWidth: modelDropdownRect.width };
  return (
    <div ref={panelRef} className="menu-card" style={{
      position: "fixed",
      bottom,
      ...panelPos,
      zIndex: 500,
      maxHeight: maxH,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      borderRadius: "var(--radius-xl)",
      padding: 5,
    }}>
      {showModelFilter && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <input
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setModelFilter("");
                setModelDropdownOpen(false);
              }
            }}
            placeholder={t("chat.filterModels")}
            aria-label={t("chat.filterModels")}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="input-base"
            style={{
              width: "100%",
              minWidth: isMobile ? 0 : 220,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              padding: "5px 8px",
              borderRadius: 0,
              boxSizing: "border-box",
            }}
          />
        </div>
      )}
      <div style={{ minHeight: 0, overflowY: "auto" }}>
        {modelsByProvider.length === 0 ? (
          <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap" }}>
            {modelFilter.trim() ? t("chat.noMatchingModels") : t("chat.noAvailableModels")}
          </div>
        ) : modelsByProvider.map((group, gi) => (
          <div key={group.provider}>
            {(modelsByProvider.length > 1) && (
              <div style={{
                padding: "6px 12px 4px",
                fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                textTransform: "uppercase", letterSpacing: "0.06em",
                borderTop: gi > 0 ? "1px solid var(--border)" : "none",
              }}>
                {group.provider}
              </div>
            )}
            {group.options.map((opt) => {
              const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
              return (
                <button
                  key={`${opt.provider}:${opt.modelId}`}
                  onClick={() => {
                    setModelDropdownOpen(false);
                    setModelFilter("");
                    if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId);
                  }}
                  className={`menu-row${isActive ? " is-active" : ""}`}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {isActive
                    ? <Icon icon={Check} size={10} strokeWidth={2} style={{ flexShrink: 0, color: "var(--accent)" }} />
                    : <span style={{ width: 10, flexShrink: 0 }} />}
                  {opt.name}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
