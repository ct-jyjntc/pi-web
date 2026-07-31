"use client";

import { ShieldCheck } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "./Icon";

export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocale();

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      style={{ zIndex: 1100, padding: 16 }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        className="modal-shell"
        style={{ width: "min(440px, 100%)" }}
      >
        <div className="modal-header" style={{ height: "auto", minHeight: 44, alignItems: "flex-start", padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
            <Icon
              icon={ShieldCheck}
              size="3xl"
              strokeWidth={1.8}
              style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }}
            />
            <div style={{ minWidth: 0 }}>
              <div id="project-trust-title" className="modal-title">
                {t("trust.dialogTitle")}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-main" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-muted)" }}>
            {t("trust.dialogBody")}
          </div>
          <code
            style={{
              display: "block",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xs)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              overflowWrap: "anywhere",
            }}
          >
            {cwd}
          </code>
          {error && (
            <div role="alert" style={{ color: "var(--destructive)", fontSize: 12, lineHeight: 1.45 }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="chrome-btn" onClick={onCancel} disabled={busy}>
            {t("trust.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy}
            style={{ opacity: busy ? 0.7 : 1 }}
          >
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>
  );
}
