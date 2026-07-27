"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Custom Windows/Linux caption buttons (min / max-restore / close).
 * Only rendered in Electron desktop shells — macOS keeps traffic lights.
 */
export function WindowControls() {
  const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
  const show =
    Boolean(desktop?.isDesktop) &&
    (desktop?.platform === "win32" || desktop?.platform === "linux") &&
    typeof desktop.windowMinimize === "function";

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!show || !desktop?.windowIsMaximized) return;
    let cancelled = false;
    void desktop.windowIsMaximized().then((v) => {
      if (!cancelled) setMaximized(Boolean(v));
    });
    const unsub = desktop.onWindowStateChange?.((state) => {
      setMaximized(Boolean(state?.maximized));
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [show, desktop]);

  const minimize = useCallback(() => {
    void desktop?.windowMinimize?.();
  }, [desktop]);

  const toggleMax = useCallback(() => {
    void desktop?.windowMaximizeToggle?.();
  }, [desktop]);

  const close = useCallback(() => {
    void desktop?.windowClose?.();
  }, [desktop]);

  if (!show) return null;

  return (
    <div className="window-controls titlebar-no-drag" role="group" aria-label="Window">
      <button
        type="button"
        className="window-control-btn"
        onClick={minimize}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-btn"
        onClick={toggleMax}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M3 3.5h4.5V8H3V3.5zM2.5 2h4v1H3.5v3.5h-1V2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="1.5"
              y="1.5"
              width="7"
              height="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              rx="0.4"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-control-btn is-close"
        onClick={close}
        title="Close"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M2 2l6 6M8 2L2 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
