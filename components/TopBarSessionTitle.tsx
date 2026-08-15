/**
 * Current session title in the app top bar, immediately right of Settings.
 * When a child transcript is open, the parent title returns to the parent chat.
 */
"use client";
import type { CSSProperties } from "react";
import type { SessionInfo } from "@/lib/types";
import { useLocale } from "@/hooks/useLocale";
import { closeChildTranscript, useChildTranscript } from "@/lib/child-transcript-store";

const TITLE_MAX_CHARS = 14;

function clipTitle(text: string): string {
  if (text.length <= TITLE_MAX_CHARS) return text;
  return `${text.slice(0, TITLE_MAX_CHARS)}...`;
}

const TITLE_SLOT: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  flex: "none",
  height: "100%",
  padding: "0 10px",
  overflow: "hidden",
};

const TITLE_TEXT: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  fontWeight: 400,
  lineHeight: "18px",
};

export function TopBarSessionTitle({
  session,
  isNewSession,
}: {
  session: SessionInfo | null;
  isNewSession: boolean;
}) {
  const { t } = useLocale();
  const child = useChildTranscript();
  if (!session && !isNewSession) return null;

  const parentTitle = (session?.name || session?.firstMessage || t("shell.newSession")).trim();
  if (!parentTitle) return null;
  const childOpen = Boolean(child && session && child.parentSessionId === session.id);
  const childTitle = (child?.title || t("ext.childTranscript")).trim();

  return (
    <>
      <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />
      {childOpen ? (
        <button
          type="button"
          className="titlebar-no-drag"
          onClick={closeChildTranscript}
          title={parentTitle}
          aria-label={parentTitle}
          style={{
            ...TITLE_SLOT,
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <span style={TITLE_TEXT}>{clipTitle(parentTitle)}</span>
        </button>
      ) : (
        <div className="titlebar-drag" title={parentTitle} aria-label={t("shell.sessionTitle")} style={TITLE_SLOT}>
          <span style={{ ...TITLE_TEXT, color: "var(--text)" }}>{clipTitle(parentTitle)}</span>
        </div>
      )}
      {childOpen ? (
        <>
          <div className="chrome-divider" aria-hidden style={{ flexShrink: 0 }} />
          <div
            className="titlebar-drag"
            title={childTitle}
            aria-label={childTitle}
            style={TITLE_SLOT}
          >
            <span style={{ ...TITLE_TEXT, color: "var(--text)" }}>{clipTitle(childTitle)}</span>
          </div>
        </>
      ) : null}
    </>
  );
}
