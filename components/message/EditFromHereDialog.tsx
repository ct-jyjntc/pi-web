/**
 * Confirm dialog for "Edit from here": edit-only vs edit + revert agent files.
 * Portaled to document.body so the dimmer covers the floating composer.
 */
"use client";

import { useEffect } from "react";
import { FilePenLine, Undo2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { CenteredDialog } from "../CenteredDialog";
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

  return (
    <CenteredDialog
      portal
      width={360}
      zIndex={3200}
      labelledBy="edit-from-here-title"
      onClose={busy ? undefined : onCancel}
    >
      <div style={{ padding: "14px 14px 10px" }}>
        <div
          id="edit-from-here-title"
          style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}
        >
          {t("msg.editFromHere")}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
          {t("msg.editFromHereDialogBody")}
        </p>
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />

      <div style={{ padding: 4 }}>
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
          onClick={() => onChoose("edit-and-revert")}
        />
      </div>

      {error ? (
        <div role="alert" style={{ padding: "4px 14px 8px", color: "var(--destructive)", fontSize: 12, lineHeight: 1.45 }}>
          {error}
        </div>
      ) : null}

      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ padding: 4 }}>
        <button type="button" className="menu-row" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>
    </CenteredDialog>
  );
}

function ChoiceRow({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: typeof FilePenLine;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="menu-row"
      disabled={disabled}
      onClick={onClick}
      style={{ alignItems: "flex-start", padding: "8px 10px", height: "auto" }}
    >
      <Icon icon={icon} size={14} strokeWidth={1.8} style={{ marginTop: 2, flexShrink: 0, color: "var(--text-muted)" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", lineHeight: 1.3 }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{description}</span>
      </span>
    </button>
  );
}
