"use client";

/**
 * Fixed-position context menu for the file explorer.
 * Pure presentational — parent owns which actions are available.
 * Text-only items (no icons) by product preference.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ExplorerMenuAction =
  | "newFile"
  | "newFolder"
  | "rename"
  | "copy"
  | "cut"
  | "paste"
  | "copyRelativePath"
  | "copyAbsolutePath"
  | "download"
  | "delete"
  | "mention";

interface MenuItem {
  id: ExplorerMenuAction;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separatorAfter?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onAction: (id: ExplorerMenuAction) => void;
  onClose: () => void;
}

export function FileExplorerContextMenu({ x, y, items, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

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
  }, [x, y, items.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    // Capture so row click handlers don't steal the dismiss.
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
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 180,
        zIndex: 90,
        padding: 4,
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            role="menuitem"
            className="sidebar-menu-item"
            disabled={item.disabled}
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
