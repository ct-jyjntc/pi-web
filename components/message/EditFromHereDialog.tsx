/**
 * Confirm dialog for "Edit from here": edit-only vs edit + revert agent files.
 * Portaled to document.body so the dimmer covers the floating composer.
 */
"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FilePenLine, Undo2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";

export type EditFromHereMode = "edit-only" | "edit-and-revert";

export function EditFromHereDialog({
  busy,
  error,
  onCancel,
  onChoose,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onChoose: (mode: EditFromHereMode) => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      style={{ zIndex: 3200 }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-from-here-title"
        className="modal-shell"
        style={{ width: "min(400px, calc(100vw - 32px))" }}
      >
        <div className="modal-header" style={{ height: "auto", minHeight: 40, padding: "10px 14px" }}>
          <div id="edit-from-here-title" className="modal-title" style={{ fontSize: 13 }}>
            {t("msg.editFromHere")}
          </div>
        </div>

        <div
          className="modal-main"
          style={{ padding: "12px 14px 8px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
            {t("msg.editFromHereDialogBody")}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <ChoiceRow
              icon={FilePenLine}
              title={t("msg.editFromHereOnly")}
              description={t("msg.editFromHereOnlyDesc")}
              disabled={busy}
              onClick={() => onChoose("edit-only")}
            />
            <ChoiceRow
              icon={Undo2}
              title={t("msg.editFromHereRevert")}
              description={t("msg.editFromHereRevertDesc")}
              disabled={busy}
              emphasized
              onClick={() => onChoose("edit-and-revert")}
            />
          </div>

          {error && (
            <div role="alert" style={{ color: "var(--destructive)", fontSize: 12, lineHeight: 1.45 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost btn-compact" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChoiceRow({
  icon,
  title,
  description,
  disabled,
  emphasized,
  onClick,
}: {
  icon: typeof FilePenLine;
  title: string;
  description: string;
  disabled?: boolean;
  emphasized?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="btn-ghost"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        height: "auto",
        minHeight: 0,
        padding: "10px 12px",
        textAlign: "left",
        borderRadius: "var(--radius-md)",
        border: emphasized
          ? "1px solid color-mix(in oklab, var(--accent) 45%, var(--border))"
          : "1px solid var(--border)",
        background: emphasized
          ? "color-mix(in oklab, var(--accent) 8%, var(--bg-panel))"
          : "var(--bg-panel)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--bg-subtle)",
          color: emphasized ? "var(--accent)" : "var(--text-muted)",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <Icon icon={icon} size="md" />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>
          {description}
        </span>
      </span>
    </button>
  );
}
