/**
 * Shared chrome for small centered dialogs (commit, trust, permissions).
 * Full-viewport dimmer + menu-card — always portaled so it covers the app.
 */
"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function CenteredDialog({
  children,
  width = 360,
  zIndex,
  labelledBy,
  label,
  onClose,
  style,
}: {
  children: ReactNode;
  width?: number | string;
  zIndex?: number;
  labelledBy?: string;
  label?: string;
  onClose?: () => void;
  /** @deprecated Always covers the viewport; kept so callers do not break. */
  portal?: boolean;
  /** @deprecated Local chat-pane dimmers are no longer used. */
  local?: boolean;
  style?: CSSProperties;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      style={zIndex != null ? { zIndex } : undefined}
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="menu-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        style={{
          width,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "100%",
          minHeight: 0,
          padding: 0,
          overflow: "hidden",
          borderRadius: "var(--radius-lg)",
          ...style,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
