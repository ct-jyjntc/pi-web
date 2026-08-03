"use client";

/**
 * Session row actions menu (opened from ⋮ or right-click).
 * Presentational — parent owns rename/delete/title side effects.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Copy,
  FolderOpen,
  Hash,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";

export type SessionMenuAction =
  | "rename"
  | "generateTitle"
  | "copyTitle"
  | "copyId"
  | "copyPath"
  | "copyCwd"
  | "delete";

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
  icon: LucideIcon;
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
    { id: "rename", label: t("common.rename"), icon: Pencil },
    {
      id: "generateTitle",
      label: naming ? t("shell.generating") : t("shell.generateTitle"),
      icon: naming ? Loader2 : Sparkles,
      disabled: !canGenerateTitle || naming,
      title: !canGenerateTitle ? t("shell.titleNeedMessage") : t("shell.titleGenerate"),
      separatorAfter: true,
    },
    { id: "copyTitle", label: t("sidebar.copyTitle"), icon: Type },
    { id: "copyId", label: t("sidebar.copySessionId"), icon: Hash },
    { id: "copyPath", label: t("sidebar.copySessionPath"), icon: Copy },
    { id: "copyCwd", label: t("sidebar.copyCwd"), icon: FolderOpen, separatorAfter: true },
    { id: "delete", label: t("common.delete"), icon: Trash2, danger: true },
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
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("scroll", onClose, true);
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
        width: 196,
        zIndex: 90,
        padding: 4,
      }}
    >
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            role="menuitem"
            className="sidebar-menu-item"
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (item.disabled) return;
              onAction(item.id);
            }}
            style={item.danger ? { color: "var(--destructive)" } : undefined}
          >
            <Icon
              icon={item.icon}
              size={13}
              strokeWidth={item.id === "generateTitle" && naming ? 2 : 1.8}
              className={item.id === "generateTitle" && naming ? "animate-spin" : undefined}
              style={{ flexShrink: 0 }}
            />
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
