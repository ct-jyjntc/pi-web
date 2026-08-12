"use client";

/**
 * Composer ⋯ overflow menu for secondary session actions (e.g. Lean recheck).
 * Keeps optional actions out of the primary toolbar chrome.
 */
import { useEffect, useRef, useState } from "react";
import { EllipsisVertical } from "lucide-react";
import { Icon } from "@/components/Icon";
import { useLocale } from "@/hooks/useLocale";

export type ComposerOverflowItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

export function ComposerOverflowMenu({
  items,
  title,
}: {
  items: ComposerOverflowItem[];
  title?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        className={`chrome-btn is-icon${open ? " is-active" : ""}`}
        title={title ?? t("chat.moreControls")}
        aria-label={title ?? t("chat.moreControls")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={EllipsisVertical} size={14} strokeWidth={2} />
      </button>
      {open ? (
        <div
          className="menu-card"
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 6px)",
            minWidth: 168,
            zIndex: 80,
            padding: 4,
            borderRadius: "var(--radius-xl)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="chrome-btn"
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              style={{
                width: "100%",
                justifyContent: "flex-start",
                fontWeight: 500,
                opacity: item.disabled ? 0.55 : 1,
                cursor: item.disabled ? "not-allowed" : "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
