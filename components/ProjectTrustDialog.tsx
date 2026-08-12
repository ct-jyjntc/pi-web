"use client";

import { ShieldCheck } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { CenteredDialog } from "./CenteredDialog";
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
    <CenteredDialog
      width={400}
      zIndex={1100}
      labelledBy="project-trust-title"
      onClose={busy ? undefined : onCancel}
    >
      <div style={{ padding: "14px 14px 10px", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Icon icon={ShieldCheck} size={16} strokeWidth={1.8} style={{ color: "var(--text-muted)", marginTop: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div
            id="project-trust-title"
            style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}
          >
            {t("trust.dialogTitle")}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
            {t("trust.dialogBody")}
          </p>
          <div
            style={{
              marginTop: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text)",
              overflowWrap: "anywhere",
            }}
          >
            {cwd}
          </div>
          {error ? (
            <div role="alert" style={{ marginTop: 8, color: "var(--destructive)", fontSize: 12, lineHeight: 1.45 }}>
              {error}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ padding: 4 }}>
        <button
          type="button"
          className="menu-row"
          onClick={onConfirm}
          disabled={busy}
          style={{ opacity: busy ? 0.55 : 1 }}
        >
          {busy ? t("trust.trusting") : t("trust.trustProject")}
        </button>
        <button type="button" className="menu-row" onClick={onCancel} disabled={busy}>
          {t("trust.cancel")}
        </button>
      </div>
    </CenteredDialog>
  );
}
