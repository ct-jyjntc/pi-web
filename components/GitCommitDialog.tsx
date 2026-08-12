/**
 * Centered commit / push dialog (GPT-style). Owns chrome only;
 * GitPanel still owns git mutations.
 */
"use client";

import { useEffect } from "react";
 import { createPortal } from "react-dom";
import { ArrowUp, Check, GitBranch, GitCommitHorizontal, Split } from "lucide-react";
import { Icon } from "./Icon";
import { useLocale } from "@/hooks/useLocale";
import { formatShortcut, hasPrimaryMod, modKeyLabel } from "@/lib/keyboard";

export type GitCommitDialogProps = {
  branch: string | null;
  message: string;
  onMessageChange: (value: string) => void;
  includeUnstaged: boolean;
  onIncludeUnstagedChange: (value: boolean) => void;
  insertions: number;
  deletions: number;
  busy: boolean;
  generating?: boolean;
  splitPlanning?: boolean;
  canCommit: boolean;
  canPush: boolean;
  /** No remotes — Push becomes "Publish to GitHub". */
  publishMode?: boolean;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onPush: () => void;
  onGenerate?: () => void;
  onSplit?: () => void;
  onClose: () => void;
};

export function GitCommitDialog({
  branch,
  message,
  onMessageChange,
  includeUnstaged,
  onIncludeUnstagedChange,
  insertions,
  deletions,
  busy,
  generating,
  splitPlanning,
  canCommit,
  canPush,
  publishMode = false,
  onCommit,
  onCommitAndPush,
  onPush,
  onGenerate,
  onSplit,
  onClose,
}: GitCommitDialogProps) {
  const { t } = useLocale();
  const shortcut = formatShortcut(modKeyLabel(), "↵");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter" && hasPrimaryMod(event) && canCommit && !busy) {
        event.preventDefault();
        onCommit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, canCommit, onClose, onCommit]);

   if (typeof document === "undefined") return null;
   return createPortal(
    <div
      className="modal-backdrop"
      style={{ zIndex: 240 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="menu-card"
        role="dialog"
        aria-label={t("git.commitOrPush")}
        style={{
          width: 360,
          maxWidth: "calc(100vw - 32px)",
          padding: 0,
          overflow: "hidden",
          borderRadius: "var(--radius-xl)",
        }}
      >
        <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon icon={GitBranch} size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {branch ?? "—"}
          </span>
        </div>

        <div style={{ position: "relative" }}>
          <textarea
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder={t("git.messageOptional")}
            rows={3}
            disabled={busy}
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "none",
              minHeight: 72,
              padding: onGenerate ? "4px 40px 12px 14px" : "4px 14px 12px",
              border: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: 13,
              lineHeight: 1.45,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          {onGenerate && (
            <button
              type="button"
              disabled={busy || generating || !canCommit}
              onClick={onGenerate}
              title={generating ? t("git.generating") : t("git.generateMessage")}
              aria-label={generating ? t("git.generating") : t("git.generateMessage")}
              style={{
                position: "absolute",
                right: 10,
                bottom: 8,
                padding: 0,
                border: "none",
                background: "transparent",
                color: "var(--text-dim)",
                font: "inherit",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                cursor: busy || generating || !canCommit ? "not-allowed" : "pointer",
                opacity: busy || generating || !canCommit ? 0.45 : 1,
              }}
            >
              AI
            </button>
          )}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            fontSize: 13,
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: "var(--radius-xs)",
              border: includeUnstaged ? "none" : "1px solid var(--border)",
              background: includeUnstaged ? "var(--accent)" : "transparent",
              color: "var(--accent-fg)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {includeUnstaged ? <Icon icon={Check} size={11} strokeWidth={2.4} /> : null}
          </span>
          <input
            type="checkbox"
            checked={includeUnstaged}
            onChange={(e) => onIncludeUnstagedChange(e.target.checked)}
            className="sr-only"
          />
          <span style={{ flex: 1 }}>{t("git.includeUnstaged")}</span>
          {(insertions > 0 || deletions > 0) && (
            <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", display: "inline-flex", gap: 6 }}>
              {insertions > 0 && <span style={{ color: "var(--success)" }}>+{insertions}</span>}
              {deletions > 0 && <span style={{ color: "var(--destructive)" }}>-{deletions}</span>}
            </span>
          )}
        </label>

        <div style={{ height: 1, background: "var(--border)" }} />

        <div style={{ padding: 4 }}>
          <button
            type="button"
            className="menu-row"
            disabled={busy || !canCommit}
            onClick={onCommit}
            style={{ opacity: busy || !canCommit ? 0.45 : 1 }}
          >
            <Icon icon={GitCommitHorizontal} size={14} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{busy ? t("git.committing") : t("git.commit")}</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                background: "var(--bg-subtle)",
                borderRadius: "var(--radius-pill)",
                padding: "1px 7px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {shortcut}
            </span>
          </button>
          <button
            type="button"
            className="menu-row"
            disabled={busy || !canCommit}
            onClick={onCommitAndPush}
            style={{ opacity: busy || !canCommit ? 0.45 : 1 }}
          >
            <Icon icon={ArrowUp} size={14} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{t("git.commitAndPush")}</span>
          </button>
          <button
            type="button"
            className="menu-row"
            disabled={busy || !canPush}
            onClick={onPush}
            style={{ opacity: busy || !canPush ? 0.45 : 1 }}
          >
            <Icon icon={ArrowUp} size={14} strokeWidth={1.8} />
            <span style={{ flex: 1 }}>{publishMode ? t("git.publish") : t("git.push")}</span>
          </button>
          {onSplit && (
            <button
              type="button"
              className="menu-row"
              disabled={busy || splitPlanning || !canCommit}
              onClick={onSplit}
              style={{ opacity: busy || splitPlanning || !canCommit ? 0.45 : 1 }}
            >
              <Icon icon={Split} size={14} strokeWidth={1.8} />
              <span style={{ flex: 1 }}>{splitPlanning ? t("git.splitRunning") : t("git.splitCommits")}</span>
            </button>
          )}
        </div>
      </div>
     </div>,
     document.body,
   );
}
