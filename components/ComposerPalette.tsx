"use client";

import type { CSSProperties, ReactNode, Ref } from "react";

export type ComposerPaletteProps = {
  title?: ReactNode;
  hint?: ReactNode;
  /** CSS max-height for the whole card (default history-sized). */
  maxHeight?: string;
  menuRef?: Ref<HTMLDivElement>;
  bodyStyle?: CSSProperties;
  children: ReactNode;
};

/**
 * Floating autocomplete chrome above the chat composer (history / slash / @).
 */
export function ComposerPalette({
  title,
  hint,
  maxHeight = "min(44vh, 360px)",
  menuRef,
  bodyStyle,
  children,
}: ComposerPaletteProps) {
  return (
    <div
      ref={menuRef}
      className="menu-card"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        maxHeight,
        overflow: "hidden",
        borderRadius: "var(--radius-md)",
        padding: 3,
      }}
    >
      {(title != null || hint != null) && (
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span>{title}</span>
        {hint != null && (
          <span style={{ fontFamily: "var(--font-mono)" }}>{hint}</span>
        )}
      </div>
      )}
      <div
        style={{
          maxHeight: title != null || hint != null ? `calc(${maxHeight} - 34px)` : maxHeight,
          overflowY: "auto",
          padding: 4,
          ...bodyStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
