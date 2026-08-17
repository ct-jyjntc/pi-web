"use client";

/**
 * Session row actions menu (opened from ⋮ or right-click).
 * Presentational — parent owns rename/delete/title side effects.
 * Text-only items (no icons). Spinner text when generating a title.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { shouldDismissMenuOnScroll } from "@/lib/menu-dismiss";

export type SessionMenuAction =
  | "rename"
  | "generateTitle"
  | "branches"
  | "systemPrompt"
  | "copyTitle"
  | "copyId"
  | "copyPath"
  | "copyCwd"
  | "archive";

interface Props {
  x: number;
  y: number;
  canGenerateTitle: boolean;
  naming: boolean;
  onAction: (id: SessionMenuAction) => void;
  onClose: () => void;
}

interface Item {
  id: SessionMenuAction;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separatorAfter?: boolean;
  title?: string;
}

export function SessionItemMenu({
  x,
  y,
  canGenerateTitle,
  naming,
  onAction,
  onClose,
}: Props) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  const items: Item[] = [
    { id: "rename", label: t("common.rename") },
    {
      id: "generateTitle",
      label: naming ? t("shell.generating") : t("shell.generateTitle"),
      disabled: !canGenerateTitle || naming,
      title: !canGenerateTitle ? t("shell.titleNeedMessage") : t("shell.titleGenerate"),
      separatorAfter: true,
    },
    { id: "branches", label: t("branch.branches") },
    { id: "systemPrompt", label: t("shell.systemPrompt"), separatorAfter: true },
    { id: "copyTitle", label: t("sidebar.copyTitle") },
    { id: "copyId", label: t("sidebar.copySessionId") },
    { id: "copyPath", label: t("sidebar.copySessionPath") },
    { id: "copyCwd", label: t("sidebar.copyCwd"), separatorAfter: true },
    { id: "archive", label: t("common.archive") },
  ];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let top = y;
    let left = x;
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    setPos({ top, left });
  }, [x, y, items.length, naming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    // Capture-phase scroll: close when the sidebar/list moves, but not when the
    // chat transcript auto-scrolls during streaming (that was dismissing menus).
    const onScroll = (event: Event) => {
      if (shouldDismissMenuOnScroll(event, ref.current)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu-card"
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 180,
        zIndex: 90,
        padding: 3,
        borderRadius: "var(--radius-md)",
      }}
    >
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            role="menuitem"
            className="menu-row"
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (item.disabled) return;
              onAction(item.id);
            }}
            style={item.danger ? { color: "var(--destructive)" } : undefined}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.label}
            </span>
          </button>
          {item.separatorAfter && (
            <div style={{ height: 1, margin: "4px 6px", background: "var(--border)" }} />
          )}
        </div>
      ))}
    </div>
  );
}
