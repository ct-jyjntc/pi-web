"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  Flame,
  MessageSquare,
  MessagesSquare,
  Package,
  Zap,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "./Icon";
import { apiFetch } from "@/lib/api-transport";

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

function fmtShare(share: number): string {
  if (share > 0 && share < 0.095) return `${(share * 100).toFixed(1)}%`;
  return `${Math.round(share * 100)}%`;
}

function StatIcon({ icon }: { icon: LucideIcon }) {
  return <Icon icon={icon} size={11} strokeWidth={1.8} />;
}

function StatCard({ icon, label, value, sub, mono }: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="usage-stat-card">
      <span className="usage-stat-label">
        {icon}
        {label}
      </span>
      <span className={`usage-stat-value${mono ? " is-mono" : ""}`}>{value}</span>
      {sub && <span className="usage-stat-sub">{sub}</span>}
    </div>
  );
}

/** Module-level SWR cache so remounting Usage (leaving & re-entering settings) is instant. */
const usageClientCache = new Map<number, { data: UsageData; at: number }>();
const USAGE_CLIENT_TTL_MS = 5 * 60 * 1000;

export function prefetchUsage(days: number = 30): void {
  const hit = usageClientCache.get(days);
  if (hit && Date.now() - hit.at < USAGE_CLIENT_TTL_MS) return;
  void apiFetch(`/api/usage?days=${days}`)
    .then(async (res) => {
      const json = await res.json() as UsageData & { error?: string };
      if (!res.ok || json.error) return;
      usageClientCache.set(days, { data: json, at: Date.now() });
    })
    .catch(() => {});
}

export function UsagePanel() {
  const { t, locale } = useLocale();
  const [days, setDays] = useState<7 | 30>(30);
  const [data, setData] = useState<UsageData | null>(() => usageClientCache.get(30)?.data ?? null);
  const [loading, setLoading] = useState(() => !usageClientCache.has(30));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: number, forceRefresh: boolean) => {
    const cached = usageClientCache.get(rangeDays);
    const hasFreshCache = cached && Date.now() - cached.at < USAGE_CLIENT_TTL_MS;

    // Stale-while-revalidate: never blank the page if we already have something to show.
    if (forceRefresh) {
      setRefreshing(true);
    } else if (cached) {
      setData(cached.data);
      // Soft TTL hit → no spinner; stale → quiet background refresh.
      if (!hasFreshCache) setRefreshing(true);
    } else if (!data) {
      setLoading(true);
    } else {
      // Switching range without a cache entry — keep prior chart, mark refreshing.
      setRefreshing(true);
    }
    setError(null);

    // Skip network when we just loaded this range (soft client TTL), unless forced.
    if (!forceRefresh && hasFreshCache) {
      setLoading(false);
      setRefreshing(false);
      // Warm the other common range in the background.
      const other = rangeDays === 30 ? 7 : 30;
      if (!usageClientCache.has(other)) prefetchUsage(other);
      return;
    }

    try {
      const res = await apiFetch(`/api/usage?days=${rangeDays}${forceRefresh ? "&refresh=1" : ""}`);
      const json = await res.json() as UsageData & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      usageClientCache.set(rangeDays, { data: json, at: Date.now() });
      setData(json);
    } catch (e) {
      // Keep last good data on background refresh failure.
      if (!cached) setError(e instanceof Error ? e.message : String(e));
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

  const modelLabel = (id: string) => (id === "__other__" ? t("usage.other") : id);

  return (
    <div className="settings-page-general">
      <div className="usage-header">
        <div className="usage-header-title">
          <div className="settings-section-title">{t("settings.usage")}</div>
          {refreshing && data && (
            <span className="usage-header-status">{t("common.loading")}</span>
          )}
        </div>
        <div className="usage-header-actions">
          <div className="settings-segmented" style={{ minWidth: 0 }}>
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`chrome-btn${days === d ? " is-active" : ""}`}
                aria-pressed={days === d}
                disabled={loading && !data}
                onClick={() => setDays(d)}
              >
                {t(d === 7 ? "usage.range7" : "usage.range30")}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost btn-compact"
            disabled={refreshing || (loading && !data)}
            onClick={() => void load(days, true)}
            title={t("common.refresh")}
          >
            {t("common.refresh")}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="usage-state">
          <div className="usage-state-text">{t("common.loading")}</div>
        </div>
      ) : error && !data ? (
        <div className="usage-state">
          <div className="usage-state-text is-error">
            {t("usage.loadError")}: {error}
          </div>
          <button type="button" className="btn-ghost btn-compact" onClick={() => void load(days, false)}>
            {t("common.refresh")}
          </button>
        </div>
      ) : !data || (data.totals.messages === 0 && data.heatmap.every((d) => d.messages === 0)) ? (
        <div className="usage-state">
          <div className="usage-state-text">{t("usage.empty")}</div>
        </div>
      ) : (
        <>
          <div className="usage-stat-grid">
            <StatCard
              icon={<StatIcon icon={Flame} />}
              label={t("usage.tokens")}
              value={fmtTokens(data.totals.tokens, locale)}
              sub={data.totals.cost > 0 ? fmtCost(data.totals.cost) : undefined}
            />
            <StatCard
              icon={<StatIcon icon={MessageSquare} />}
              label={t("usage.sessions")}
              value={data.totals.sessions.toLocaleString()}
            />
            <StatCard
              icon={<StatIcon icon={MessagesSquare} />}
              label={t("usage.messages")}
              value={data.totals.messages.toLocaleString()}
            />
            <StatCard
              icon={<StatIcon icon={Calendar} />}
              label={t("usage.activeDays")}
              value={String(data.totals.activeDays)}
            />
            <StatCard
              icon={<StatIcon icon={Zap} />}
              label={t("usage.streak")}
              value={String(data.streak)}
            />
            <StatCard
              icon={<StatIcon icon={Package} />}
              label={t("usage.topModel")}
              value={data.topModel?.id ?? "—"}
              sub={data.topModel ? t("usage.shareOfTokens", { pct: Math.round(data.topModel.share * 100) }) : undefined}
              mono
            />
          </div>

          <div className="usage-section">
            <div className="settings-section-title">{t("usage.heatmap")}</div>
            <div className="usage-heatmap-scroll">
              <div className="usage-heatmap">
                {heatWeeks.map((week, wi) => (
                  <div key={wi} className="usage-heatmap-week">
                    {week.map((cell, di) => (
                      <div
                        key={cell?.date ?? `blank-${wi}-${di}`}
                        className={`usage-heatmap-cell${cell ? "" : " is-empty"}`}
                        title={cell ? `${cell.date} · ${t("usage.messagesCount", { n: cell.messages })}` : undefined}
                        style={cell ? { background: HEAT_LEVELS[heatLevel(cell.messages)] } : undefined}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="usage-heatmap-legend">
              <span>{t("usage.less")}</span>
              {HEAT_LEVELS.map((c) => (
                <span key={c} className="usage-heatmap-legend-swatch" style={{ background: c }} />
              ))}
              <span>{t("usage.more")}</span>
            </div>
          </div>

          <div className="usage-section">
            <div className="settings-section-title">{t("usage.trend")}</div>
            <div className="usage-trend-chart">
              <div className={`usage-trend-bars${days === 7 ? " is-week" : ""}`}>
                {data.trend.map((day) => {
                  const dm = dayModels(day);
                  const painted = series
                    .map((id, i) => ({ id, i, v: dm[id] ?? 0 }))
                    .filter((s) => s.v > 0);
                  return (
                    <div
                      key={day.date}
                      className="usage-trend-col"
                      title={`${day.date} · ${fmtTokens(day.tokens, locale)} ${t("usage.tokens")}`}
                    >
                      {painted.map((s, pi) => (
                        <div
                          key={s.id}
                          className={`usage-trend-seg${pi === painted.length - 1 ? " is-top" : ""}`}
                          style={{
                            height: Math.max(2, (s.v / trendMax) * 118),
                            background: seriesColor(s.i),
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="usage-trend-labels">
              {data.trend.map((day, i) => {
                const step = Math.ceil(data.trend.length / 6);
                const show = i % step === 0 || i === data.trend.length - 1;
                return (
                  <div key={day.date} className="usage-trend-label">
                    {show ? fmtDayLabel(day.date, locale) : ""}
                  </div>
                );
              })}
            </div>
            <div className="usage-series-legend">
              {series.map((id, i) => (
                <span key={id} className="usage-series-item">
                  <span className="usage-series-dot" style={{ background: seriesColor(i) }} />
                  <span className="usage-series-name">{modelLabel(id)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="usage-section">
            <div className="settings-section-title">{t("usage.modelUsage")}</div>
            <div className="usage-model-split">
              <svg
                className="usage-donut"
                width="128"
                height="128"
                viewBox="0 0 128 128"
                role="img"
                aria-label={t("usage.modelUsage")}
              >
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
                <text
                  x="64"
                  y="60"
                  textAnchor="middle"
                  style={{ fill: "var(--text)", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtTokens(data.totals.tokens, locale)}
                </text>
                <text x="64" y="76" textAnchor="middle" style={{ fill: "var(--text-dim)", fontSize: 10 }}>
                  {t("usage.tokens")}
                </text>
              </svg>
              <div className="usage-model-list">
                {donutSegments.map((m, i) => (
                  <div key={m.id} className="usage-model-row">
                    <span className="usage-series-dot" style={{ background: seriesColor(i) }} />
                    <span className="usage-model-name" title={modelLabel(m.id)}>{modelLabel(m.id)}</span>
                    <span className="usage-model-tokens">
                      {fmtTokens(m.tokens, locale)}
                    </span>
                    <span className="usage-model-share">{fmtShare(m.share)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
