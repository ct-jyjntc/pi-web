/**
 * Combined model + thinking chip. One compact menu; lists drill in
 * inside the same card — no second flyout.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import { useWebSettings } from "@/lib/web-settings-store";
import {
  THINKING_LEVELS,
  THINKING_LEVEL_KEYS,
  filterModelOptions,
  MODEL_FILTER_THRESHOLD,
  type ModelOption,
} from "./chat-input-shared";

type ThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type Pane = "hub" | "model" | "thinking";

const MENU_WIDTH = 216;

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "4px 8px",
  border: "none",
   borderRadius: "var(--radius-sm)",
  background: "transparent",
  fontSize: 12,
};

export type ComposerModelChipProps = {
  isMobile: boolean;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  modelOptions: ModelOption[];
  isAutoModelSelection?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  thinkingLevel?: ThinkingLevel;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  defaultModel?: { provider: string; modelId: string } | null;
};

export function ComposerModelChip({
  isMobile,
  isStreaming,
  model,
  modelOptions,
  isAutoModelSelection,
  onModelChange,
  thinkingLevel,
  availableThinkingLevels,
  thinkingLevelMap,
  onThinkingLevelChange,
  defaultModel,
}: ComposerModelChipProps) {
  const { t } = useLocale();
  const settings = useWebSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("hub");
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");

  const currentName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : (modelOptions.length > 0 ? t("chat.selectModel") : t("chat.noModels"));
  const thinkingLabel = t(THINKING_LEVEL_KEYS[thinkingLevel ?? "auto"]);
  const showModel = !!onModelChange && (modelOptions.length > 0 || !!model);
  const showThinking = !!onThinkingLevelChange && !isStreaming;
  const showChip = showModel || showThinking;

  const close = useCallback(() => {
    setOpen(false);
    setPane("hub");
    setModelFilter("");
  }, []);

  const openMenu = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (isStreaming) return;
    if (open) {
      close();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ top: rect.top, right: rect.right });
    setPane("hub");
    setOpen(true);
  }, [close, isStreaming, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pane !== "hub") setPane("hub");
        else close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open, pane]);

  const groups = useMemo(() => {
    const filtered = filterModelOptions(modelOptions, modelFilter);
    const next: { provider: string; options: ModelOption[] }[] = [];
    for (const opt of filtered) {
      const group = next.find((g) => g.provider === opt.provider);
      if (group) group.options.push(opt);
      else next.push({ provider: opt.provider, options: [opt] });
    }
    return next;
  }, [modelFilter, modelOptions]);

  const thinkingOptions = THINKING_LEVELS.filter((lvl) => {
    if (lvl === "auto") return true;
    const hasUserMap = !!(thinkingLevelMap && Object.keys(thinkingLevelMap).length > 0);
    if (hasUserMap) return lvl in thinkingLevelMap! && thinkingLevelMap![lvl] !== null;
    if (!availableThinkingLevels) return true;
    return availableThinkingLevels.includes(lvl);
  });

  if (!showChip) return null;

  const viewportHeight = typeof window === "undefined" ? 800 : (window.visualViewport?.height ?? window.innerHeight);
  const viewportWidth = typeof window === "undefined" ? 1200 : (window.visualViewport?.width ?? window.innerWidth);
  const bottom = anchor ? viewportHeight - anchor.top + 6 : 8;
  const right = anchor ? Math.max(8, viewportWidth - anchor.right) : 8;
  const maxH = anchor ? Math.max(160, Math.min(anchor.top - 10, viewportHeight * 0.5)) : 240;

  const resetThinking = THINKING_LEVELS.includes((settings?.defaultThinkingLevel ?? "auto") as ThinkingLevel)
    ? (settings?.defaultThinkingLevel as ThinkingLevel)
    : "auto";
  const reset = () => {
    if (onThinkingLevelChange && thinkingLevel !== resetThinking) onThinkingLevelChange(resetThinking);
    if (defaultModel && onModelChange) {
      if (model?.provider !== defaultModel.provider || model?.modelId !== defaultModel.modelId) {
        onModelChange(defaultModel.provider, defaultModel.modelId);
      }
    }
    close();
  };

  return (
    <div ref={rootRef} className="composer-model-chip" style={{ position: "relative" }}>
      <button
        type="button"
        className={`chrome-btn composer-model-btn${open ? " is-active" : ""}`}
        onClick={openMenu}
        disabled={isStreaming}
        title={`${currentName} · ${thinkingLabel}`}
        aria-label={`${currentName} · ${thinkingLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="composer-model-name">
          {currentName}
        </span>
        {showThinking ? (
          <span className="composer-model-thinking">{thinkingLabel}</span>
        ) : null}
      </button>

      {open && anchor && (
        <div
          ref={menuRef}
          className="menu-card"
          role="menu"
          style={{
            position: "fixed",
            zIndex: 500,
            bottom,
            ...(isMobile ? { left: 8, right: 8 } : { right, width: MENU_WIDTH }),
            maxHeight: maxH,
            display: "flex",
            flexDirection: "column",
            borderRadius: "var(--radius-md)",
            padding: 3,
            overflow: "hidden",
          }}
        >
          {pane !== "hub" && (
            <button
              type="button"
              className="menu-row"
              onClick={() => setPane("hub")}
              style={{ ...ROW, flexShrink: 0, borderBottom: "1px solid var(--border)", borderRadius: 0 }}
            >
              <Icon icon={ChevronLeft} size={12} strokeWidth={1.8} />
              {pane === "model" ? t("chat.model") : t("chat.reasoning")}
            </button>
          )}

          {pane === "hub" && (
            <div style={{ padding: 2 }}>
              {showModel && (
                <button type="button" className="menu-row" style={ROW} onClick={() => setPane("model")}>
                  <span style={{ flex: 1 }}>{t("chat.model")}</span>
                  <span style={{ color: "var(--text-dim)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentName}</span>
                  <Icon icon={ChevronRight} size={12} strokeWidth={1.8} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                </button>
              )}
              {showThinking && (
                <button type="button" className="menu-row" style={ROW} onClick={() => setPane("thinking")}>
                  <span style={{ flex: 1 }}>{t("chat.reasoning")}</span>
                  <span style={{ color: "var(--text-dim)" }}>{thinkingLabel}</span>
                  <Icon icon={ChevronRight} size={12} strokeWidth={1.8} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                </button>
              )}
              {(onModelChange || onThinkingLevelChange) && (
                <>
                  <div style={{ height: 1, background: "var(--border)", margin: "2px 6px" }} />
                  <button type="button" className="menu-row" style={ROW} onClick={reset}>
                    <span style={{ flex: 1 }}>{t("chat.resetDefaults")}</span>
                    <Icon icon={RotateCcw} size={12} strokeWidth={1.8} />
                  </button>
                </>
              )}
            </div>
          )}

          {pane === "model" && onModelChange && (
            <div style={{ minHeight: 0, overflowY: "auto", padding: 2 }}>
              {modelOptions.length > MODEL_FILTER_THRESHOLD && (
                <input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="input-base"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 12,
                    padding: "4px 8px",
                    marginBottom: 2,
                  }}
                />
              )}
              {groups.length === 0 ? (
                <div style={{ padding: "6px 8px", color: "var(--text-dim)", fontSize: 12 }}>
                  {modelFilter.trim() ? t("chat.noMatchingModels") : t("chat.noAvailableModels")}
                </div>
              ) : groups.map((group) => (
                <div key={group.provider}>
                  {groups.length > 1 && (
                    <div style={{ padding: "4px 8px 0", fontSize: 10, color: "var(--text-dim)" }}>
                      {group.provider}
                    </div>
                  )}
                  {group.options.map((opt) => {
                    const active = opt.modelId === model?.modelId && opt.provider === model?.provider;
                    return (
                      <button
                        key={`${opt.provider}:${opt.modelId}`}
                        type="button"
                        className={`menu-row${active ? " is-active" : ""}`}
                        style={ROW}
                        onClick={() => {
                          if (!active || isAutoModelSelection) onModelChange(opt.provider, opt.modelId);
                          setPane("hub");
                        }}
                      >
                        {active
                          ? <Icon icon={Check} size={11} strokeWidth={2} style={{ color: "var(--accent)", flexShrink: 0 }} />
                          : <span style={{ width: 11, flexShrink: 0 }} />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {pane === "thinking" && onThinkingLevelChange && (
            <div style={{ minHeight: 0, overflowY: "auto", padding: 2 }}>
              {thinkingOptions.map((lvl) => {
                const active = (thinkingLevel ?? "auto") === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    className={`menu-row${active ? " is-active" : ""}`}
                    style={ROW}
                    onClick={() => {
                      if (!active) onThinkingLevelChange(lvl);
                      setPane("hub");
                    }}
                  >
                    {active
                      ? <Icon icon={Check} size={11} strokeWidth={2} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      : <span style={{ width: 11, flexShrink: 0 }} />}
                    {t(THINKING_LEVEL_KEYS[lvl])}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
