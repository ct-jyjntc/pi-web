"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "./settings/settings-ui";
import { apiFetch } from "@/lib/api-transport";

type UsageData = {
  generatedAt: string;
  range: { days: number; startDate: string };
  totals: {
    tokens: number;
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
/** Bar track height — must match `.usage-trend-bars` height in globals.css. */
const TREND_TRACK_PX = 120;
/** Per-segment floor so tiny series stay visible; reserved per series so the
 *  stacked minimums of the tallest day can never exceed the track. */
const TREND_MIN_SEG_PX = 2;

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

/** Module-level SWR cache so remounting Usage (leaving & re-entering settings) is instant. */
const usageClientCache = new Map<number, { data: UsageData; at: number }>();
const USAGE_CLIENT_TTL_MS = 5 * 60 * 1000;
const usageListeners = new Set<() => void>();

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

/** Drop the client cache so the next load (or a mounted panel) refetches. */
export function invalidateUsage(): void {
  usageClientCache.clear();
  if (usageListeners.size === 0) {
    void apiFetch("/api/usage?days=30&refresh=1")
      .then(async (res) => {
        const json = await res.json() as UsageData & { error?: string };
        if (!res.ok || json.error) return;
        usageClientCache.set(30, { data: json, at: Date.now() });
      })
      .catch(() => {});
    return;
  }
  for (const listener of usageListeners) listener();
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

  useEffect(() => {
    const onInvalidate = () => {
      void load(days, true);
    };
    usageListeners.add(onInvalidate);
    return () => {
      usageListeners.delete(onInvalidate);
    };
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

  const trendDays = useMemo(() => {
    if (!data) return [];
    const first = data.trend.findIndex((d) => d.tokens > 0);
    return first <= 0 ? data.trend : data.trend.slice(first);
  }, [data]);

  const trendMax = useMemo(
    () => Math.max(1, ...trendDays.map((d) => d.tokens), 1),
    [trendDays],
  );
  const trendUsablePx = TREND_TRACK_PX - TREND_MIN_SEG_PX * Math.max(1, series.length);

  const modelLabel = (id: string) => (id === "__other__" ? t("usage.other") : id);

  return (
    <div className="settings-page-general">
      <SettingsPageHeading
        title={t("settings.usage")}
        description={refreshing && data ? t("common.loading") : undefined}
        action={
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
          </div>
        }
      />

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
          <SettingsGroup>
            <SettingsRow
              title={t("usage.tokens")}
              action={<span className="settings-row-metric">{fmtTokens(data.totals.tokens, locale)}</span>}
            />
            <SettingsRow
              title={t("usage.sessions")}
              action={<span className="settings-row-metric">{data.totals.sessions.toLocaleString()}</span>}
            />
            <SettingsRow
              title={t("usage.messages")}
              action={<span className="settings-row-metric">{data.totals.messages.toLocaleString()}</span>}
            />
            <SettingsRow
              title={t("usage.activeDays")}
              action={<span className="settings-row-metric">{data.totals.activeDays}</span>}
            />
            <SettingsRow
              title={t("usage.streak")}
              action={<span className="settings-row-metric">{data.streak}</span>}
            />
            <SettingsRow
              title={t("usage.topModel")}
              action={
                <span className="settings-row-metric">
                  {data.topModel?.id ?? "—"}
                  {data.topModel ? (
                    <span className="settings-row-metric-sub">
                      {t("usage.shareOfTokens", { pct: Math.round(data.topModel.share * 100) })}
                    </span>
                  ) : null}
                </span>
              }
            />
          </SettingsGroup>

          <SettingsGroup title={t("usage.heatmap")} framed={false}>
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
          </SettingsGroup>

          <SettingsGroup title={t("usage.trend")}>
            <div className="usage-card-body">
              <div className="usage-trend-chart">
                <div className={`usage-trend-bars${days === 7 ? " is-week" : ""}`}>
                  {trendDays.map((day) => {
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
                        <div className="usage-trend-bar">
                          {painted.map((s) => (
                            <div
                              key={s.id}
                              className="usage-trend-seg"
                              style={{
                                height: Math.max(TREND_MIN_SEG_PX, (s.v / trendMax) * trendUsablePx),
                                background: seriesColor(s.i),
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className={`usage-trend-labels${days === 7 ? " is-week" : ""}`}>
                {trendDays.map((day, i) => {
                  const step = Math.ceil(trendDays.length / 6);
                  const show = i % step === 0 || i === trendDays.length - 1;
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
          </SettingsGroup>

          <SettingsGroup title={t("usage.modelUsage")}>
            {donutSegments.map((m, i) => (
              <SettingsRow
                key={m.id}
                title={(
                  <>
                    <span className="usage-series-dot" style={{ background: seriesColor(i) }} />
                    {modelLabel(m.id)}
                  </>
                )}
                action={
                  <span className="settings-row-metric">
                    {fmtTokens(m.tokens, locale)}
                    <span className="settings-row-metric-sub">{fmtShare(m.share)}</span>
                  </span>
                }
              />
            ))}
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
