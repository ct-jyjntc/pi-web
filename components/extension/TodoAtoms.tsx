"use client";

import type { TodoItem } from "@/lib/extension-widgets";

/** Shared status glyph for todo items (top bar + in-chat extension widgets). */
export function TodoDot({ status }: { status: TodoItem["status"] }) {
  const color =
    status === "completed" ? "var(--success)"
      : status === "in_progress" ? "var(--accent)"
        : "var(--text-dim)";
  const symbol =
    status === "completed" ? "✓"
      : status === "in_progress" ? "●"
        : "○";
  return (
    <span style={{ color, width: 12, flexShrink: 0, fontSize: 11, lineHeight: "16px", textAlign: "center" }}>
      {symbol}
    </span>
  );
}

/** Shared todo row used by chrome popover and extension cards. */
export function TodoItemRow({ item }: { item: TodoItem; index?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "3px 6px",
      }}
    >
      <TodoDot status={item.status} />
      <div
        style={{
          minWidth: 0,
          flex: 1,
          fontSize: 12,
          lineHeight: 1.35,
          color: item.status === "completed" ? "var(--text-dim)" : "var(--text)",
          textDecoration: item.status === "completed" ? "line-through" : "none",
        }}
      >
        {item.id ? (
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, marginRight: 4 }}>
            #{item.id}
          </span>
        ) : null}
        {item.text}
      </div>
    </div>
  );
}
