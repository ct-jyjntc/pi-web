"use client";

import type { CSSProperties, ReactNode } from "react";

const EMBEDDED_SHELL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  width: "100%",
  background: "var(--bg)",
};

export type ConfigPanelShellProps = {
  embedded?: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional id for aria-labelledby (non-embedded dialogs). */
  titleId?: string;
  onClose?: () => void;
  closeAriaLabel: string;
  /** Override outer shell dimensions / layout. */
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * Shared chrome for Models / Skills / MCP config panels:
 * embedded page mode vs floating modal-shell + header + optional close.
 */
export function ConfigPanelShell({
  embedded,
  title,
  subtitle,
  titleId,
  onClose,
  closeAriaLabel,
  style,
  children,
}: ConfigPanelShellProps) {
  return (
    <div
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby={titleId}
      className={embedded ? "settings-embedded" : "modal-shell"}
      style={style ?? (embedded ? EMBEDDED_SHELL_STYLE : undefined)}
    >
      <div className="modal-header" style={embedded ? { borderRadius: 0 } : undefined}>
        <div className="modal-header-meta">
          {typeof title === "string" || typeof title === "number" ? (
            <span id={titleId} className="modal-title">{title}</span>
          ) : (
            <div id={titleId} className="modal-title">{title}</div>
          )}
          {subtitle != null && subtitle !== false && (
            typeof subtitle === "string" || typeof subtitle === "number" ? (
              <code className="modal-subtitle">{subtitle}</code>
            ) : (
              subtitle
            )
          )}
        </div>
        {!embedded && onClose && (
          <button
            type="button"
            className="chrome-btn is-icon"
            onClick={onClose}
            aria-label={closeAriaLabel}
          >
            ×
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function ConfigPanelBackdrop({
  onClose,
  children,
  style,
}: {
  onClose: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      style={style}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
