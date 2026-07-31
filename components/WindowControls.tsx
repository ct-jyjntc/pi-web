"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Icon } from "./Icon";

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
        <Icon icon={Minus} size={10} strokeWidth={1.2} />
      </button>
      <button
        type="button"
        className="window-control-btn"
        onClick={toggleMax}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <Icon icon={Copy} size={10} strokeWidth={1.2} />
        ) : (
          <Icon icon={Square} size={10} strokeWidth={1.2} />
        )}
      </button>
      <button
        type="button"
        className="window-control-btn is-close"
        onClick={close}
        title="Close"
        aria-label="Close"
      >
        <Icon icon={X} size={10} strokeWidth={1.2} />
      </button>
    </div>
  );
}
