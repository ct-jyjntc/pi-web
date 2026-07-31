/**
 * Client appearance prefs — hydrated from /api/web-settings, applied live.
 */
import { useSyncExternalStore } from "react";
import { ensureWebSettings } from "@/lib/web-settings-store";
import type { CodeThemeId, ThemeMode } from "@/lib/web-settings";

export type AppearanceSnapshot = {
  themeMode: ThemeMode;
  uiFontSize: number;
  codeThemeLight: CodeThemeId;
  codeThemeDark: CodeThemeId;
  showCodeLineNumbers: boolean;
  wrapCodeLines: boolean;
  codeFontSize: number;
};

const DEFAULTS: AppearanceSnapshot = {
  themeMode: "system",
  uiFontSize: 14,
  codeThemeLight: "vs",
  codeThemeDark: "vscDarkPlus",
  showCodeLineNumbers: true,
  wrapCodeLines: false,
  codeFontSize: 12.5,
};

const listeners = new Set<() => void>();
let snapshot: AppearanceSnapshot = { ...DEFAULTS };
let hydrated = false;

function emit() {
  for (const l of listeners) l();
}

export function getAppearanceSnapshot(): AppearanceSnapshot {
  return snapshot;
}

export function setAppearanceSnapshot( partial: Partial<AppearanceSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  applyAppearanceToDocument(snapshot);
  emit();
}

export function applyAppearanceToDocument(prefs: AppearanceSnapshot = snapshot): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--ui-font-size", `${prefs.uiFontSize}px`);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore(subscribe, getAppearanceSnapshot, () => DEFAULTS);
}

/** One-shot hydrate from server; safe to call multiple times. */
export function hydrateAppearanceFromServer(): void {
  if (typeof window === "undefined" || hydrated) return;
  hydrated = true;
  // Apply localStorage cache first for less FOUC
  try {
    const cached = localStorage.getItem("pi-appearance");
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<AppearanceSnapshot>;
      snapshot = { ...DEFAULTS, ...parsed };
      applyAppearanceToDocument(snapshot);
    }
  } catch {
    // ignore
  }
  void ensureWebSettings()
    .then((s) => {
      if (!s) return;
      snapshot = {
        themeMode: (s.themeMode as ThemeMode) ?? snapshot.themeMode,
        uiFontSize: typeof s.uiFontSize === "number" ? s.uiFontSize : snapshot.uiFontSize,
        codeThemeLight: (s.codeThemeLight as CodeThemeId) ?? snapshot.codeThemeLight,
        codeThemeDark: (s.codeThemeDark as CodeThemeId) ?? snapshot.codeThemeDark,
        showCodeLineNumbers: typeof s.showCodeLineNumbers === "boolean" ? s.showCodeLineNumbers : snapshot.showCodeLineNumbers,
        wrapCodeLines: typeof s.wrapCodeLines === "boolean" ? s.wrapCodeLines : snapshot.wrapCodeLines,
        codeFontSize: typeof s.codeFontSize === "number" ? s.codeFontSize : snapshot.codeFontSize,
      };
      try {
        localStorage.setItem("pi-appearance", JSON.stringify(snapshot));
      } catch {
        // ignore
      }
      applyAppearanceToDocument(snapshot);
      emit();
    })
    .catch(() => {});
}
