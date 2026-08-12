"use client";

/**
 * Modal listing global keyboard shortcuts. Opened via ⌘/Ctrl+/.
 */
import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { formatShortcut, modKeyLabel } from "@/lib/keyboard";
import { CenteredDialog } from "./CenteredDialog";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Row = { keys: string; label: string };

export function ShortcutsHelpDialog({ open, onClose }: Props) {
  const { t } = useLocale();
  const [ready, setReady] = useState(false);
  const mod = modKeyLabel();

  useEffect(() => {
    setReady(true);
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

  if (!open || !ready) return null;

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

  return (
    <CenteredDialog portal width={380} label={t("shortcuts.title")} onClose={onClose}>
      <div style={{ padding: "14px 14px 8px", fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {t("shortcuts.title")}
      </div>
      <div style={{ padding: "0 4px 8px", maxHeight: "min(480px, calc(100dvh - 80px))", overflowY: "auto" }}>
        {rows.map((row) => (
          <div
            key={`${row.keys}:${row.label}`}
            className="menu-row"
            style={{ cursor: "default" }}
          >
            <span style={{ flex: 1, minWidth: 0, color: "var(--text)" }}>{row.label}</span>
            <span
              style={{
                flexShrink: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                background: "var(--bg-subtle)",
                borderRadius: "var(--radius-pill)",
                padding: "1px 7px",
              }}
            >
              {row.keys}
            </span>
          </div>
        ))}
      </div>
    </CenteredDialog>
  );
}
