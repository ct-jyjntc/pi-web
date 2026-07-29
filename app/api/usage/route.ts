import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { createInterface } from "readline";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

/**
 * Usage statistics aggregated from pi session .jsonl files.
 *
 * Session files can be tens of MB in total, so parsing is streaming and
 * field-extraction is substring-based (assistant lines carry huge thinking
 * blocks; a full JSON.parse per line is needlessly expensive). The aggregate
 * is cached on globalThis keyed by a file inventory signature
 * (path:size:mtimeMs) so repeat loads only re-scan changed files.
 */

type DayBucket = {
  /** Local date YYYY-MM-DD */
  date: string;
  tokens: number;
  cost: number;
  messages: number;
  /** modelId -> totalTokens */
  models: Record<string, number>;
  sessionIds: Set<string>;
};

type UsageAggregate = {
  days: Map<string, DayBucket>;
  builtAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const HEATMAP_DAYS = 26 * 7;
const MAX_RANGE_DAYS = 366;

declare global {
  var __piUsageCache: { signature: string; at: number; data: UsageAggregate } | undefined;
  var __piUsagePromise: Promise<UsageAggregate> | undefined;
}

function dateKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function shiftKey(key: string, deltaDays: number): string {
  return dateKey(new Date(`${key}T12:00:00`).getTime() + deltaDays * 86_400_000);
}

/** Extract a "key":"value" string field starting the search at `from`. */
function sliceStringField(line: string, field: string, from: number): string | null {
  const idx = line.indexOf(`"${field}":"`, from);
  if (idx === -1) return null;
  const start = idx + field.length + 4;
  const end = line.indexOf('"', start);
  return end === -1 ? null : line.slice(start, end);
}

/** Extract a "key":number field starting the search at `from`. */
function sliceNumberField(line: string, field: string, from: number): number {
  const idx = line.indexOf(`"${field}":`, from);
  if (idx === -1) return 0;
  const start = idx + field.length + 3;
  let end = start;
  while (end < line.length && /[\d.]/.test(line[end])) end++;
  const n = Number(line.slice(start, end));
  return Number.isFinite(n) ? n : 0;
}

async function parseSessionFile(filePath: string, sessionId: string, days: Map<string, DayBucket>): Promise<void> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('{"type":"message"')) continue;
    const tsRaw = sliceStringField(line, "timestamp", 0);
    if (!tsRaw) continue;
    const ts = Date.parse(tsRaw);
    if (!Number.isFinite(ts)) continue;

    const roleStart = line.indexOf('"role":"');
    if (roleStart === -1) continue;
    const roleEnd = line.indexOf('"', roleStart + 8);
    const role = line.slice(roleStart + 8, roleEnd);
    if (role !== "user" && role !== "assistant") continue;

    const key = dateKey(ts);
    let bucket = days.get(key);
    if (!bucket) {
      bucket = { date: key, tokens: 0, cost: 0, messages: 0, models: {}, sessionIds: new Set() };
      days.set(key, bucket);
    }
    bucket.messages++;
    bucket.sessionIds.add(sessionId);

    if (role !== "assistant") continue;
    const usageIdx = line.indexOf('"usage":{');
    if (usageIdx === -1) continue;
    const tokens = sliceNumberField(line, "totalTokens", usageIdx);
    if (tokens <= 0) continue;
    const cost = sliceNumberField(line, "total", usageIdx);
    // The message-level "model" field sits right before "usage" (after the
    // content blob), so the LAST occurrence before usageIdx is the real one.
    const modelIdx = line.lastIndexOf('"model":"', usageIdx);
    let model = "unknown";
    if (modelIdx !== -1) {
      const start = modelIdx + 9;
      const end = line.indexOf('"', start);
      if (end !== -1) model = line.slice(start, end) || "unknown";
    }
    bucket.tokens += tokens;
    bucket.cost += cost;
    bucket.models[model] = (bucket.models[model] ?? 0) + tokens;
  }
}

async function buildAggregate(): Promise<UsageAggregate> {
  const sessions = await SessionManager.listAll();
  const days = new Map<string, DayBucket>();
  // Modest concurrency keeps disk IO friendly on large session archives.
  const queue = [...sessions];
  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      try {
        await parseSessionFile(s.path, s.id, days);
      } catch {
        // Skip unreadable/corrupt session files — stats stay best-effort.
      }
    }
  });
  await Promise.all(workers);
  return { days, builtAt: Date.now() };
}

async function getAggregate(forceRefresh: boolean): Promise<UsageAggregate> {
  let signature = "";
  try {
    const sessions = await SessionManager.listAll();
    signature = sessions
      .map((s) => {
        try {
          const st = statSync(s.path);
          return `${s.path}:${st.size}:${Math.round(st.mtimeMs)}`;
        } catch {
          return `${s.path}:gone`;
        }
      })
      .join("|");
  } catch {
    // If listing fails, fall through with an empty signature (no cache reuse).
  }

  const cache = globalThis.__piUsageCache;
  if (!forceRefresh && cache && cache.signature === signature && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  if (!forceRefresh && globalThis.__piUsagePromise) return globalThis.__piUsagePromise;

  const promise = buildAggregate()
    .then((data) => {
      globalThis.__piUsageCache = { signature, at: Date.now(), data };
      return data;
    })
    .finally(() => {
      globalThis.__piUsagePromise = undefined;
    });
  globalThis.__piUsagePromise = promise;
  return promise;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const forceRefresh = params.get("refresh") === "1";
    const daysParam = Number(params.get("days") ?? "30");
    const rangeDays = Number.isFinite(daysParam)
      ? Math.min(MAX_RANGE_DAYS, Math.max(1, Math.round(daysParam)))
      : 30;

    const agg = await getAggregate(forceRefresh);
    const today = dateKey(Date.now());
    const startDate = shiftKey(today, -(rangeDays - 1));

    let tokens = 0;
    let cost = 0;
    let messages = 0;
    let activeDays = 0;
    const rangeSessionIds = new Set<string>();
    const modelTotals = new Map<string, number>();

    for (const bucket of agg.days.values()) {
      if (bucket.date < startDate || bucket.date > today) continue;
      tokens += bucket.tokens;
      cost += bucket.cost;
      messages += bucket.messages;
      if (bucket.messages > 0) activeDays++;
      for (const id of bucket.sessionIds) rangeSessionIds.add(id);
      for (const [model, v] of Object.entries(bucket.models)) {
        modelTotals.set(model, (modelTotals.get(model) ?? 0) + v);
      }
    }

    const models = [...modelTotals.entries()]
      .map(([id, v]) => ({ id, tokens: v, share: tokens > 0 ? v / tokens : 0 }))
      .sort((a, b) => b.tokens - a.tokens);
    const topModel = models[0] ?? null;

    // Zero-filled daily trend for the selected range.
    const trend: Array<{ date: string; tokens: number; models: Record<string, number> }> = [];
    for (let i = 0; i < rangeDays; i++) {
      const date = shiftKey(startDate, i);
      const bucket = agg.days.get(date);
      trend.push({
        date,
        tokens: bucket?.tokens ?? 0,
        models: bucket ? { ...bucket.models } : {},
      });
    }

    // Heatmap: fixed trailing window, independent of the selected range.
    const heatmapStart = shiftKey(today, -(HEATMAP_DAYS - 1));
    const heatmap: Array<{ date: string; messages: number }> = [];
    for (let i = 0; i < HEATMAP_DAYS; i++) {
      const date = shiftKey(heatmapStart, i);
      heatmap.push({ date, messages: agg.days.get(date)?.messages ?? 0 });
    }

    // Current streak of consecutive active days (today counts; otherwise
    // start from yesterday so a today-not-yet-active run still shows).
    const isActive = (key: string) => (agg.days.get(key)?.messages ?? 0) > 0;
    let cursor = isActive(today) ? today : shiftKey(today, -1);
    let streak = 0;
    while (isActive(cursor)) {
      streak++;
      cursor = shiftKey(cursor, -1);
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      range: { days: rangeDays, startDate },
      totals: {
        tokens,
        cost: Math.round(cost * 100) / 100,
        sessions: rangeSessionIds.size,
        messages,
        activeDays,
      },
      streak,
      topModel,
      models,
      trend,
      heatmap,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
