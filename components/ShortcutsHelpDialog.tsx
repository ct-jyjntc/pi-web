"use client";

/**
 * Modal listing global keyboard shortcuts. Opened via ⌘/Ctrl+/.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { formatShortcut, modKeyLabel } from "@/lib/keyboard";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Row = { keys: string; label: string };

export function ShortcutsHelpDialog({ open, onClose }: Props) {
  const { t } = useLocale();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const mod = modKeyLabel();

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !portalTarget) return null;

  const rows: Row[] = [
    { keys: formatShortcut(mod, "B"), label: t("shortcuts.toggleSidebar") },
    { keys: formatShortcut(mod, ","), label: t("shortcuts.settings") },
    { keys: formatShortcut(mod, "\\"), label: t("shortcuts.toggleRightPanel") },
    { keys: formatShortcut(mod, "L"), label: t("shortcuts.focusComposer") },
    { keys: formatShortcut(mod, "⇧", "N"), label: t("shortcuts.newSession") },
    { keys: "Ctrl+Alt+N", label: t("shortcuts.newSession") },
    { keys: formatShortcut(mod, "1"), label: t("shortcuts.tabReview") },
    { keys: formatShortcut(mod, "2"), label: t("shortcuts.tabFiles") },
    { keys: formatShortcut(mod, "3"), label: t("shortcuts.tabContext") },
    { keys: formatShortcut(mod, "4"), label: t("shortcuts.tabTerminal") },
    { keys: "Esc", label: t("shortcuts.abort") },
    { keys: formatShortcut(mod, "/"), label: t("shortcuts.thisHelp") },
  ];

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("shortcuts.title")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-shell"
        style={{
          width: 420,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "min(560px, calc(100dvh - 16px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: 0,
        }}
      >
        <div className="modal-header">
          <div className="modal-title">{t("shortcuts.title")}</div>
          <button
            type="button"
            className="chrome-btn is-icon"
            onClick={onClose}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <Icon icon={X} size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "8px 0 12px" }}>
          {rows.map((row) => (
            <div
              key={`${row.keys}:${row.label}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "7px 16px",
                fontSize: 12.5,
              }}
            >
              <span style={{ color: "var(--text)", minWidth: 0 }}>{row.label}</span>
              <kbd
                style={{
                  flexShrink: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-xs)",
                  padding: "2px 7px",
                }}
              >
                {row.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
