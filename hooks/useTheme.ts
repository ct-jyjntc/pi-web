"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ThemeMode } from "@/lib/web-settings";
import { hydrateAppearanceFromServer, setAppearanceSnapshot } from "@/lib/appearance-store";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function notifyDesktopTheme(theme: Theme) {
  try {
    const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
    if (!desktop?.isDesktop || typeof desktop.setTheme !== "function") return;
    void desktop.setTheme(theme);
  } catch {
    // ignore
  }
}

function osPrefersDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredThemeMode(): ThemeMode {
  try {
    const mode = localStorage.getItem("pi-theme-mode");
    if (mode === "light" || mode === "dark" || mode === "system") return mode;
    const legacy = localStorage.getItem("pi-theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    // ignore
  }
  return "system";
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === "system") return osPrefersDark() ? "dark" : "light";
  return mode;
}

function applyResolvedTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  notifyDesktopTheme(theme);
  listeners.forEach((cb) => cb());
}

function applyThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem("pi-theme-mode", mode);
    if (mode === "system") localStorage.removeItem("pi-theme");
    else localStorage.setItem("pi-theme", mode);
  } catch {
    // ignore
  }
  applyResolvedTheme(resolveTheme(mode));
  setAppearanceSnapshot({ themeMode: mode });
}

// Follow OS when mode is system (or legacy empty preference).
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener?.("change", (e) => {
      try {
        if (readStoredThemeMode() !== "system") return;
      } catch {
        // ignore
      }
      applyResolvedTheme(e.matches ? "dark" : "light");
    });
}

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    hydrateAppearanceFromServer();
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode, origin?: ToggleOrigin) => {
    const next = resolveTheme(mode);
    const apply = () => applyThemeMode(mode);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";
    if (!supportsVT || reduceMotion || next === getSnapshot()) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {});
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    setThemeMode(next, origin);
  }, [setThemeMode]);

  useEffect(() => {
    notifyDesktopTheme(theme);
  }, [theme]);

  return {
    theme,
    themeMode: readStoredThemeMode(),
    toggleTheme,
    setThemeMode,
    isDark: theme === "dark",
  };
}
