"use client";

import { Check, Circle, CircleDot } from "lucide-react";
import type { TodoItem } from "@/lib/extension-widgets";
import { Icon } from "../Icon";

function sameLabel(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

function TodoMark({ status }: { status: TodoItem["status"] }) {
   const style = { marginTop: 1, flexShrink: 0 } as const;
   if (status === "completed") {
     return <Icon icon={Check} size={12} strokeWidth={2} style={{ ...style, color: "var(--text-dim)" }} />;
   }
   if (status === "in_progress") {
     return <Icon icon={CircleDot} size={12} strokeWidth={1.8} style={{ ...style, color: "var(--text)" }} />;
   }
   return <Icon icon={Circle} size={12} strokeWidth={1.8} style={{ ...style, color: "var(--text-dim)" }} />;
}

/** Shared todo row used by chrome popover and extension cards. */
export function TodoItemRow({ item }: { item: TodoItem; index?: number }) {
  const active = item.status === "in_progress";
  const done = item.status === "completed";
  const subtitle = item.activeForm && !sameLabel(item.activeForm, item.text) ? item.activeForm : null;
  return (
    <div
      style={{
        display: "flex",
         alignItems: subtitle ? "flex-start" : "center",
         gap: 6,
         padding: "3px 6px",
         boxSizing: "border-box",
       }}
     >
       <TodoMark status={item.status} />
       <div style={{ minWidth: 0, flex: 1 }}>
         <div
           style={{
             fontSize: 12,
             lineHeight: 1.35,
             fontWeight: active ? 500 : 400,
            color: done ? "var(--text-dim)" : "var(--text)",
          }}
        >
          {item.text}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 1,
              fontSize: 11,
              lineHeight: 1.35,
              color: "var(--text-dim)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
