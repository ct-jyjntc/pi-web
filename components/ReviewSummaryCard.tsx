"use client";

import { useLocale } from "@/hooks/useLocale";
import {
  countFindingsByPriority,
  type ReviewPriority,
  type ReviewReport,
} from "@/lib/review-report";

const PRIORITY_ORDER: ReviewPriority[] = ["P0", "P1", "P2", "P3"];

const PRIORITY_STYLE: Record<ReviewPriority, { color: string; bg: string; border: string }> = {
  P0: { color: "var(--destructive)", bg: "var(--destructive-bg)", border: "var(--destructive-border)" },
  P1: { color: "var(--destructive)", bg: "var(--destructive-bg)", border: "var(--destructive-border)" },
  P2: { color: "var(--text)", bg: "var(--bg-subtle)", border: "var(--border)" },
  P3: { color: "var(--text-muted)", bg: "var(--bg-subtle)", border: "var(--border)" },
};

export function ReviewSummaryCard({ report }: { report: ReviewReport }) {
  const { t } = useLocale();
  const counts = countFindingsByPriority(report.findings);
  const ok = report.overall_correctness === "correct";

  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: "var(--radius-md)",
        border: `1px solid ${ok ? "var(--success-border)" : "var(--destructive-border)"}`,
        background: ok ? "var(--success-bg)" : "var(--destructive-bg)",
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
            color: ok ? "var(--success)" : "var(--destructive)",
          }}
        >
          {t("git.reviewSummary")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: ok ? "var(--success)" : "var(--destructive)",
            border: `1px solid ${ok ? "var(--success-border)" : "var(--destructive-border)"}`,
            borderRadius: "var(--radius-xs)",
            padding: "1px 6px",
          }}
        >
          {ok ? t("git.reviewCorrect") : t("git.reviewIncorrect")}
        </span>
        {PRIORITY_ORDER.map((p) => (
          counts[p] > 0 ? (
            <span
              key={p}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                color: PRIORITY_STYLE[p].color,
                background: PRIORITY_STYLE[p].bg,
                border: `1px solid ${PRIORITY_STYLE[p].border}`,
                borderRadius: "var(--radius-xs)",
                padding: "1px 5px",
              }}
            >
              {p}×{counts[p]}
            </span>
          ) : null
        ))}
      </div>

      {report.explanation && (
        <div style={{ color: "var(--text)", lineHeight: 1.45, marginBottom: report.findings.length ? 8 : 0 }}>
          {report.explanation}
        </div>
      )}

      {report.findings.length > 0 && (
        <ul style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {report.findings.map((f, i) => (
            <li key={`${f.priority}-${f.title}-${i}`} style={{ color: "var(--text)", lineHeight: 1.4 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: PRIORITY_STYLE[f.priority].color,
                  marginRight: 6,
                }}
              >
                {f.priority}
              </span>
              <strong style={{ fontWeight: 600 }}>{f.title}</strong>
              {f.file_path && (
                <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, marginLeft: 6 }}>
                  {f.file_path}
                  {f.line_start != null ? `:${f.line_start}` : ""}
                </span>
              )}
              <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{f.body}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
