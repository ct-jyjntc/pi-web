/**
 * Current session title in the app top bar, immediately right of Settings.
 */
"use client";

import type { SessionInfo } from "@/lib/types";
import { useLocale } from "@/hooks/useLocale";

export function TopBarSessionTitle({
  session,
  isNewSession,
}: {
  session: SessionInfo | null;
  isNewSession: boolean;
}) {
  const { t } = useLocale();
  if (!session && !isNewSession) return null;

  const title = (session?.name || session?.firstMessage || t("shell.newSession")).trim();
  if (!title) return null;

  return (
    <>
      <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />
      <div
        className="titlebar-drag"
        title={title}
        aria-label={t("shell.sessionTitle")}
        style={{
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          width: 200,
          minWidth: 200,
          flex: "none",
          height: "100%",
          padding: "0 10px",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontWeight: 400,
            lineHeight: "18px",
            color: "var(--text)",
          }}
        >
          {title}
        </span>
      </div>
    </>
  );
}
