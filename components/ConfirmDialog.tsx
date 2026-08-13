/**
 * In-app confirm — replaces window.confirm.
 * Same CenteredDialog / menu-card chrome as YOLO and Allow-grep.
 */
"use client";

import { useLocale } from "@/hooks/useLocale";
import { CenteredDialog } from "./CenteredDialog";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  destructive,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  destructive?: boolean;
}) {
  const { t } = useLocale();
  return (
    <CenteredDialog
      width={360}
      zIndex={1300}
      labelledBy="confirm-dialog-title"
      onClose={busy ? undefined : onCancel}
    >
      <div style={{ padding: "14px 14px 8px" }}>
        <div
          id="confirm-dialog-title"
          style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}
        >
          {title}
        </div>
        {body ? (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45, color: "var(--text-muted)" }}>
            {body}
          </div>
        ) : null}
      </div>
      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ padding: 4 }}>
        <button
          type="button"
          className="menu-row"
          disabled={busy}
          onClick={onConfirm}
          style={destructive ? { color: "var(--destructive)", opacity: busy ? 0.55 : 1 } : busy ? { opacity: 0.55 } : undefined}
        >
          {confirmLabel}
        </button>
        <button type="button" className="menu-row" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </CenteredDialog>
  );
}
