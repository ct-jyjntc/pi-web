"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";

type UsageData = {
  generatedAt: string;
  range: { days: number; startDate: string };
  totals: {
    tokens: number;
    cost: number;
    sessions: number;
    messages: number;
    activeDays: number;
  };
  streak: number;
  topModel: { id: string; tokens: number; share: number } | null;
  models: Array<{ id: string; tokens: number; share: number }>;
  trend: Array<{ date: string; tokens: number; models: Record<string, number> }>;
  heatmap: Array<{ date: string; messages: number }>;
};

/** Monochrome series ramp (strongest first) — charts stay on the accent token. */
const SERIES_COLORS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 64%, var(--bg))",
  "color-mix(in oklab, var(--accent) 44%, var(--bg))",
  "color-mix(in oklab, var(--accent) 28%, var(--bg))",
  "color-mix(in oklab, var(--accent) 17%, var(--bg))",
  "color-mix(in oklab, var(--accent) 10%, var(--bg))",
];
const HEAT_LEVELS = [
  "var(--bg-subtle)",
  "color-mix(in oklab, var(--accent) 18%, var(--bg))",
  "color-mix(in oklab, var(--accent) 36%, var(--bg))",
  "color-mix(in oklab, var(--accent) 58%, var(--bg))",
  "color-mix(in oklab, var(--accent) 85%, var(--bg))",
];
const TOP_SERIES = 5;

function fmtTokens(n: number, locale: string): string {
  if (locale === "zh") {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
    return String(n);
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  return `$${n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
}

function fmtDayLabel(date: string, locale: string): string {
  const [, m, d] = date.split("-").map(Number);
  return locale === "zh" ? `${m}月${d}日` : `${m}/${d}`;
}

function seriesColor(i: number): string {
  return SERIES_COLORS[Math.min(i, SERIES_COLORS.length - 1)];
}

function StatIcon({ path }: { path: ReactNode }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}

function StatCard({ icon, label, value, sub, mono }: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="settings-status-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 2, minHeight: 0 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-dim)" }}>
        {icon}
        {label}
      </span>
      <span
        style={{
          fontSize: mono ? 13 : 18,
          fontWeight: 600,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{sub}</span>}
    </div>
  );
}

export function UsagePanel() {
  const { t, locale } = useLocale();
  const [days, setDays] = useState<7 | 30>(30);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: number, forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/usage?days=${rangeDays}${forceRefresh ? "&refresh=1" : ""}`);
      const json = await res.json() as UsageData & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(days, false);
  }, [days, load]);

  // Top-N series + "other" bucket for stacked charts.
  const series = useMemo(() => {
    if (!data) return [] as string[];
    const ids = data.models.slice(0, TOP_SERIES).map((m) => m.id);
    if (data.models.length > TOP_SERIES) ids.push("__other__");
    return ids;
  }, [data]);

  const dayModels = useCallback((day: UsageData["trend"][number]) => {
    const out: Record<string, number> = {};
    let other = 0;
    for (const [id, v] of Object.entries(day.models)) {
      if (series.includes(id)) out[id] = v;
      else other += v;
    }
    if (other > 0) out.__other__ = other;
    return out;
  }, [series]);

  const donutSegments = useMemo(() => {
    if (!data) return [] as Array<{ id: string; tokens: number; share: number }>;
    const top = data.models.slice(0, TOP_SERIES);
    const rest = data.models.slice(TOP_SERIES);
    if (rest.length > 0) {
      const tokens = rest.reduce((s, m) => s + m.tokens, 0);
      top.push({ id: "__other__", tokens, share: data.totals.tokens > 0 ? tokens / data.totals.tokens : 0 });
    }
    return top;
  }, [data]);

  const heatWeeks = useMemo(() => {
    if (!data) return [] as Array<Array<{ date: string; messages: number } | null>>;
    const daysList = data.heatmap;
    const first = daysList[0];
    if (!first) return [];
    const lead = new Date(`${first.date}T12:00:00`).getDay(); // Sunday-first columns
    const cells: Array<{ date: string; messages: number } | null> = [
      ...Array.from({ length: lead }, () => null),
      ...daysList,
    ];
    const weeks: Array<Array<{ date: string; messages: number } | null>> = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [data]);

  const heatMax = useMemo(
    () => Math.max(1, ...(data?.heatmap.map((d) => d.messages) ?? [1])),
    [data],
  );

  const heatLevel = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((n / heatMax) * 4)));

  const trendMax = useMemo(
    () => Math.max(1, ...(data?.trend.map((d) => d.tokens) ?? [1])),
    [data],
  );

  const sectionTitle = (text: string) => (
    <div className="settings-section-title">{text}</div>
  );

  const modelLabel = (id: string) => (id === "__other__" ? t("usage.other") : id);

  return (
    <div className="settings-page-general">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="settings-section-title" style={{ margin: 0, padding: 0 }}>
          {t("settings.usage")}
        </div>
        <div className="settings-segmented" style={{ minWidth: 0 }}>
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`chrome-btn${days === d ? " is-active" : ""}`}
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {t(d === 7 ? "usage.range7" : "usage.range30")}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="settings-row-desc" style={{ padding: "24px 0", textAlign: "center" }}>{t("common.loading")}</div>
      ) : error && !data ? (
        <div style={{ padding: "24px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--destructive)" }}>
            {t("usage.loadError")}: {error}
          </div>
          <button type="button" className="btn-ghost btn-compact" onClick={() => void load(days, false)}>
            {t("common.refresh")}
          </button>
        </div>
      ) : !data || (data.totals.messages === 0 && data.heatmap.every((d) => d.messages === 0)) ? (
        <div className="settings-row-desc" style={{ padding: "24px 0", textAlign: "center" }}>{t("usage.empty")}</div>
      ) : (
        <>
          <div className="usage-stat-grid">
            <StatCard
              icon={<StatIcon path={<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />} />}
              label={t("usage.tokens")}
              value={fmtTokens(data.totals.tokens, locale)}
              sub={data.totals.cost > 0 ? fmtCost(data.totals.cost) : undefined}
            />
            <StatCard
              icon={<StatIcon path={<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>} />}
              label={t("usage.sessions")}
              value={data.totals.sessions.toLocaleString()}
            />
            <StatCard
              icon={<StatIcon path={<><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2v5z" /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" /></>} />}
              label={t("usage.messages")}
              value={data.totals.messages.toLocaleString()}
            />
            <StatCard
              icon={<StatIcon path={<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>} />}
              label={t("usage.activeDays")}
              value={String(data.totals.activeDays)}
            />
            <StatCard
              icon={<StatIcon path={<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />} />}
              label={t("usage.streak")}
              value={String(data.streak)}
            />
            <StatCard
              icon={<StatIcon path={<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>} />}
              label={t("usage.topModel")}
              value={data.topModel?.id ?? "—"}
              sub={data.topModel ? t("usage.shareOfTokens", { pct: Math.round(data.topModel.share * 100) }) : undefined}
              mono
            />
          </div>

          {sectionTitle(t("usage.heatmap"))}
          <div style={{ overflowX: "auto", paddingBottom: 2 }}>
            <div style={{ display: "flex", gap: 2, width: "max-content" }}>
              {heatWeeks.map((week, wi) => (
                <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {week.map((cell, di) => (
                    <div
                      key={cell?.date ?? `blank-${wi}-${di}`}
                      title={cell ? `${cell.date} · ${t("usage.messagesCount", { n: cell.messages })}` : undefined}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "var(--radius-xs)",
                        background: cell ? HEAT_LEVELS[heatLevel(cell.messages)] : "transparent",
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("usage.less")}</span>
            {HEAT_LEVELS.map((c) => (
              <span key={c} style={{ width: 10, height: 10, borderRadius: "var(--radius-xs)", background: c }} />
            ))}
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("usage.more")}</span>
          </div>

          {sectionTitle(t("usage.trend"))}
          <div style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: days === 7 ? 10 : 3, height: 120 }}>
              {data.trend.map((day) => {
                const dm = dayModels(day);
                const painted = series
                  .map((id, i) => ({ id, i, v: dm[id] ?? 0 }))
                  .filter((s) => s.v > 0);
                return (
                  <div
                    key={day.date}
                    title={`${day.date} · ${fmtTokens(day.tokens, locale)} tokens`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                    }}
                  >
                    {painted.map((s, pi) => (
                      <div
                        key={s.id}
                        style={{
                          height: Math.max(2, (s.v / trendMax) * 118),
                          background: seriesColor(s.i),
                          flexShrink: 0,
                          // Only the topmost segment rounds its top corners;
                          // the base sits squarely on the axis line.
                          ...(pi === painted.length - 1
                            ? { borderRadius: "var(--radius-xs) var(--radius-xs) 0 0" }
                            : {}),
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 4 }}>
            {data.trend.map((day, i) => {
              const step = Math.ceil(data.trend.length / 6);
              const show = i % step === 0 || i === data.trend.length - 1;
              return (
                <div key={day.date} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {show ? fmtDayLabel(day.date, locale) : ""}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }}>
            {series.map((id, i) => (
              <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: seriesColor(i), flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{modelLabel(id)}</span>
              </span>
            ))}
          </div>

          {sectionTitle(t("usage.modelUsage"))}
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={t("usage.modelUsage")} style={{ flexShrink: 0 }}>
              <circle cx="64" cy="64" r="50" fill="none" style={{ stroke: "var(--bg-subtle)" }} strokeWidth="16" />
              {(() => {
                const C = 2 * Math.PI * 50;
                let acc = 0;
                return donutSegments.map((m, i) => {
                  const frac = data.totals.tokens > 0 ? m.tokens / data.totals.tokens : 0;
                  if (frac <= 0) return null;
                  const dash = frac * C;
                  const offset = -acc * C;
                  acc += frac;
                  return (
                    <circle
                      key={m.id}
                      cx="64"
                      cy="64"
                      r="50"
                      fill="none"
                      style={{ stroke: seriesColor(i) }}
                      strokeWidth="16"
                      strokeDasharray={`${dash} ${C - dash}`}
                      strokeDashoffset={offset}
                      transform="rotate(-90 64 64)"
                    />
                  );
                });
              })()}
              <text x="64" y="60" textAnchor="middle" style={{ fill: "var(--text)", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {fmtTokens(data.totals.tokens, locale)}
              </text>
              <text x="64" y="76" textAnchor="middle" style={{ fill: "var(--text-dim)", fontSize: 10 }}>
                tokens
              </text>
            </svg>
            <div style={{ flex: 1, minWidth: 220 }}>
              {donutSegments.map((m, i) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 0",
                    borderBottom: i < donutSegments.length - 1 ? "1px solid color-mix(in oklab, var(--border) 70%, transparent)" : "none",
                    fontSize: 12,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: seriesColor(i), flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {modelLabel(m.id)}
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 11, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {fmtTokens(m.tokens, locale)} tokens
                  </span>
                  <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", width: 40, textAlign: "right", flexShrink: 0 }}>
                    {`${m.share > 0 && m.share < 0.095 ? (m.share * 100).toFixed(1) : Math.round(m.share * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button
              type="button"
              className="btn-ghost btn-compact"
              disabled={refreshing}
              onClick={() => void load(days, true)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {refreshing ? t("common.loading") : t("common.refresh")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
