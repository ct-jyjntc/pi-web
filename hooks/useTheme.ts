"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

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

/** Keep Windows/Linux titleBarOverlay caption buttons in sync with app theme. */
function notifyDesktopTheme(theme: Theme) {
  try {
    const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
    if (!desktop?.isDesktop || typeof desktop.setTheme !== "function") return;
    void desktop.setTheme(theme);
  } catch {
    // preload / non-desktop — ignore
  }
}

// Users with no stored preference follow the OS theme, including live
// changes. An explicit toggle (which writes "pi-theme") opts out.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener?.("change", (e) => {
      try {
        if (localStorage.getItem("pi-theme")) return;
      } catch {
        // ignore storage errors — fall through and follow the OS
      }
      document.documentElement.classList.toggle("dark", e.matches);
      notifyDesktopTheme(e.matches ? "dark" : "light");
      listeners.forEach((cb) => cb());
    });
}

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";

    const apply = () => {
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      try {
        localStorage.setItem("pi-theme", next);
      } catch {
        // ignore storage errors (private mode, quota, etc.)
      }
      notifyDesktopTheme(next);
      listeners.forEach((cb) => cb());
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
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
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  // Sync on mount / external theme flips (settings, OS preference).
  useEffect(() => {
    notifyDesktopTheme(theme);
  }, [theme]);

  return { theme, toggleTheme, isDark: theme === "dark" };
}
