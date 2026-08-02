"use client";

/** Circular context-usage meter for the compact control. */
export function ContextUsageRing({ percent, size = 12 }: { percent: number | null; size?: number }) {
  const r = 4.25;
  const c = 2 * Math.PI * r;
  const pct = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  const offset = c * (1 - pct / 100);
  // Quiet monochrome fill; turns to text color when high, destructive when critical.
  const stroke =
    percent == null ? "var(--text-dim)"
      : pct > 90 ? "var(--destructive)"
        : pct > 70 ? "var(--text)"
          : "var(--text-muted)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="6" cy="6" r={r} stroke="var(--border)" strokeWidth="1.5" />
      <circle
        cx="6"
        cy="6"
        r={r}
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 6 6)"
        style={{ transition: "stroke-dashoffset 0.2s ease, stroke 0.15s ease" }}
      />
    </svg>
  );
}

