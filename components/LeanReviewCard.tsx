"use client";

/**
 * High-signal Lean Mode review card (change-shape smells only).
 */
import { useLocale } from "@/hooks/useLocale";
import type { LeanReport } from "@/lib/lean-review-types";

export function LeanReviewCard({
  report,
  model,
  busy,
  onDismiss,
  onRerun,
}: {
  report: LeanReport;
  model?: string;
  busy?: boolean;
  onDismiss?: () => void;
  onRerun?: () => void;
}) {
  const { t } = useLocale();
  const concern =
    report.verdict === "bloated" || report.findings.some((f) => f.severity === "P1");
  const verdictLabel =
    report.verdict === "bloated"
      ? t("lean.verdictBloated")
      : report.verdict === "lean"
        ? t("lean.verdictLean")
        : t("lean.verdictUnclear");

  return (
    <div
      style={{
        margin: "8px 12px 0",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${concern ? "var(--destructive-border)" : "var(--border)"}`,
        background: concern ? "var(--destructive-bg)" : "var(--bg-subtle)",
        padding: "10px 12px",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: concern ? "var(--destructive)" : "var(--text-muted)",
          }}
        >
          {t("lean.reviewTitle")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: concern ? "var(--destructive)" : "var(--text)",
            border: `1px solid ${concern ? "var(--destructive-border)" : "var(--border)"}`,
            borderRadius: "var(--radius-xs)",
            padding: "1px 6px",
          }}
        >
          {verdictLabel}
        </span>
        {model ? (
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
            {model}
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {onRerun ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={onRerun}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              {busy ? t("lean.reviewRunning") : t("lean.reviewManual")}
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={onDismiss}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              {t("lean.dismiss")}
            </button>
          ) : null}
        </span>
      </div>

      {report.summary ? (
        <div style={{ color: "var(--text)", marginBottom: report.findings.length ? 8 : 0 }}>
          {report.summary}
        </div>
      ) : null}

      {report.findings.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "var(--text-muted)" }}>
          {report.findings.map((f, i) => (
            <li key={`${f.kind}-${i}`} style={{ marginBottom: 6 }}>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                [{f.severity}] {f.title}
              </span>
              <div style={{ marginTop: 2 }}>{f.body}</div>
              {f.file_path ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  {f.file_path}
                </div>
              ) : null}
              {f.suggestion ? (
                <div style={{ marginTop: 2, color: "var(--text)" }}>→ {f.suggestion}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
