"use client";

/** Ephemeral chat toasts — compact status cards above the composer / empty state. */
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { NoticeItem, NoticeType } from "@/hooks/useAgentSession";
import { Icon } from "../Icon";

const NOTICE_ICON: Record<NoticeType, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function NoticeShelf({
  notices,
  floating = false,
  align = "left",
}: {
  notices: NoticeItem[];
  floating?: boolean;
  align?: "left" | "right";
}) {
  if (notices.length === 0) return null;
  return (
    <div
      className={`notice-shelf${floating ? " is-floating" : ""}${align === "right" ? " is-end" : ""}`}
      role="status"
      aria-live="polite"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`notice-shelf-item is-${notice.type}${notice.exiting ? " is-exiting" : ""}`}
        >
          <div className="notice-shelf-card">
            <Icon
              icon={NOTICE_ICON[notice.type]}
              size="lg"
              className="notice-shelf-icon"
              aria-hidden
            />
            <span className="notice-shelf-message">{notice.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
