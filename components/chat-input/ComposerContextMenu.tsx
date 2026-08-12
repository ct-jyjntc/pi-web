"use client";

/**
 * Right-click menu for the chat composer textarea (cut / copy / paste / select / clear).
 * Owns clipboard ops against a live textarea; parent only supplies value + setValue.
 * Text-only items (no icons).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { shouldDismissMenuOnScroll } from "@/lib/menu-dismiss";
import { useLocale } from "@/hooks/useLocale";

export type ComposerMenuAction = "cut" | "copy" | "paste" | "selectAll" | "clear";

interface Props {
  x: number;
  y: number;
  /** Live textarea — selection is read/written here. */
  textarea: HTMLTextAreaElement | null;
  value: string;
  setValue: (next: string) => void;
  /** After value/selection changes (at-query, height). */
  onAfterEdit?: (next: string, cursor: number) => void;
  onClose: () => void;
}

interface MenuItem {
  id: ComposerMenuAction;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separatorAfter?: boolean;
}

function replaceSelection(
  value: string,
  start: number,
  end: number,
  insert: string,
): { next: string; cursor: number } {
  const next = value.slice(0, start) + insert + value.slice(end);
  return { next, cursor: start + insert.length };
}

export function ComposerContextMenu({
  x,
  y,
  textarea,
  value,
  setValue,
  onAfterEdit,
  onClose,
}: Props) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  const selection = useMemo(() => {
    if (!textarea) return { start: value.length, end: value.length, text: "" };
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    return {
      start,
      end,
      text: value.slice(start, end),
    };
  }, [textarea, value]);

  const hasSelection = selection.start !== selection.end;
  const hasText = value.length > 0;

  const items: MenuItem[] = [
    { id: "cut", label: t("chat.cut"), disabled: !hasSelection },
    { id: "copy", label: t("common.copy"), disabled: !hasSelection },
    { id: "paste", label: t("chat.paste"), separatorAfter: true },
    { id: "selectAll", label: t("chat.selectAll"), disabled: !hasText },
    { id: "clear", label: t("chat.clearInput"), disabled: !hasText, danger: true },
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
  }, [x, y, items.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
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

  const applyEdit = useCallback((next: string, cursor: number, selectEnd?: number) => {
    setValue(next);
    requestAnimationFrame(() => {
      const ta = textarea;
      if (ta) {
        ta.focus();
        const end = selectEnd ?? cursor;
        ta.setSelectionRange(cursor, end);
      }
      onAfterEdit?.(next, cursor);
    });
  }, [setValue, textarea, onAfterEdit]);

  const handleAction = useCallback(async (id: ComposerMenuAction) => {
    const start = textarea?.selectionStart ?? selection.start;
    const end = textarea?.selectionEnd ?? selection.end;

    switch (id) {
      case "cut": {
        if (start === end) break;
        const text = value.slice(start, end);
        try { await copyText(text); } catch { /* ignore */ }
        const { next, cursor } = replaceSelection(value, start, end, "");
        applyEdit(next, cursor);
        break;
      }
      case "copy": {
        if (start === end) break;
        try { await copyText(value.slice(start, end)); } catch { /* ignore */ }
        break;
      }
      case "paste": {
        let clip = "";
        try {
          clip = await navigator.clipboard.readText();
        } catch {
          // Permission denied / non-secure context — leave value unchanged.
          break;
        }
        if (!clip) break;
        const { next, cursor } = replaceSelection(value, start, end, clip);
        applyEdit(next, cursor);
        break;
      }
      case "selectAll": {
        requestAnimationFrame(() => {
          const ta = textarea;
          if (!ta) return;
          ta.focus();
          ta.setSelectionRange(0, value.length);
        });
        break;
      }
      case "clear": {
        applyEdit("", 0);
        break;
      }
    }
    onClose();
  }, [textarea, selection.start, selection.end, value, applyEdit, onClose]);

  return (
    <div
      ref={ref}
      className="menu-card"
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 160,
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
            onClick={() => { void handleAction(item.id); }}
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
