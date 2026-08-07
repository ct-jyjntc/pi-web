import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { listSessionFiles, readSessionHeader } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * Usage statistics aggregated from pi session .jsonl files.
 *
 * Session archives can be large, so:
 * - the session list comes from readdir + header-only reads (never a full parse)
 * - lines are streamed (no full-file reads)
 * - field extraction is substring-based (assistant lines carry huge thinking blocks)
 * - per-file results are cached by size:mtime so only changed sessions are re-parsed
 * - a soft TTL returns the last aggregate without re-statting (instant repeat opens)
 */

type DayBucket = {
  /** Local date YYYY-MM-DD */
  date: string;
  tokens: number;
  messages: number;
  /** modelId -> totalTokens */
  models: Record<string, number>;
  sessionIds: Set<string>;
};

type FileDaySlice = {
  date: string;
  tokens: number;
  messages: number;
  models: Record<string, number>;
  sessionId: string;
};

type FileCacheEntry = {
  sig: string;
  days: FileDaySlice[];
};

type UsageAggregate = {
  days: Map<string, DayBucket>;
  builtAt: number;
};

/** Serve last aggregate without re-stat (typical "open Usage again" path). */
const SOFT_TTL_MS = 45_000;
/** After soft TTL, re-stat; reuse per-file parses when size/mtime unchanged. */
const HARD_TTL_MS = 15 * 60 * 1000;
const HEATMAP_DAYS = 26 * 7;
const MAX_RANGE_DAYS = 366;

declare global {
  var __piUsageCache: { signature: string; at: number; data: UsageAggregate } | undefined;
  var __piUsagePromise: Promise<UsageAggregate> | undefined;
  var __piUsageFileCache: Map<string, FileCacheEntry> | undefined;
}

function fileCache(): Map<string, FileCacheEntry> {
  if (!globalThis.__piUsageFileCache) globalThis.__piUsageFileCache = new Map();
  return globalThis.__piUsageFileCache;
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

async function parseSessionFile(filePath: string, sessionId: string): Promise<FileDaySlice[]> {
  const byDate = new Map<string, FileDaySlice>();
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
    let bucket = byDate.get(key);
    if (!bucket) {
      bucket = { date: key, tokens: 0, messages: 0, models: {}, sessionId };
      byDate.set(key, bucket);
    }
    bucket.messages++;

    if (role !== "assistant") continue;
    const usageIdx = line.indexOf('"usage":{');
    if (usageIdx === -1) continue;
    const tokens = sliceNumberField(line, "totalTokens", usageIdx);
    if (tokens <= 0) continue;
    // Message-level "model" sits just before "usage"; last match before usageIdx wins.
    const modelIdx = line.lastIndexOf('"model":"', usageIdx);
    let model = "unknown";
    if (modelIdx !== -1) {
      const start = modelIdx + 9;
      const end = line.indexOf('"', start);
      if (end !== -1) model = line.slice(start, end) || "unknown";
    }
    bucket.tokens += tokens;
    bucket.models[model] = (bucket.models[model] ?? 0) + tokens;
  }
  return [...byDate.values()];
}

function mergeSlices(slices: Iterable<FileDaySlice[]>): Map<string, DayBucket> {
  const days = new Map<string, DayBucket>();
  for (const fileDays of slices) {
    for (const slice of fileDays) {
      let bucket = days.get(slice.date);
      if (!bucket) {
        bucket = {
          date: slice.date,
          tokens: 0,
          messages: 0,
          models: {},
          sessionIds: new Set(),
        };
        days.set(slice.date, bucket);
      }
      bucket.tokens += slice.tokens;
      bucket.messages += slice.messages;
      bucket.sessionIds.add(slice.sessionId);
      for (const [model, v] of Object.entries(slice.models)) {
        bucket.models[model] = (bucket.models[model] ?? 0) + v;
      }
    }
  }
  return days;
}

/** Session id from the archive's header line, or undefined when unreadable. */
function readSessionId(filePath: string): string | undefined {
  try {
    return readSessionHeader(filePath)?.id;
  } catch {
    return undefined;
  }
}

async function buildAggregate(): Promise<{ data: UsageAggregate; signature: string }> {
  // Path-sorted so the aggregate signature is stable across readdir orderings.
  const files = (await listSessionFiles()).sort((a, b) => a.path.localeCompare(b.path));
  const cache = fileCache();
  const livePaths = new Set<string>();
  const sigParts: string[] = [];
  const queue: Array<{ path: string; id: string; sig: string }> = [];

  for (const file of files) {
    // The session id sits in the header line; SessionManager.listAll() would parse
    // every archive end-to-end (~180ms / 68MB locally) just to hand back path + id.
    const id = readSessionId(file.path);
    // Headerless archives are skipped by SessionManager.listAll() as well.
    if (!id) continue;
    livePaths.add(file.path);
    const sig = `${file.path}:${file.size}:${Math.round(file.mtimeMs)}`;
    sigParts.push(sig);
    queue.push({ path: file.path, id, sig });
  }

  // Drop entries for sessions that no longer exist.
  for (const key of cache.keys()) {
    if (!livePaths.has(key)) cache.delete(key);
  }

  // Only re-parse files whose size/mtime signature changed.
  const dirty = queue.filter((s) => cache.get(s.path)?.sig !== s.sig);
  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const item = dirty.shift();
      if (!item) return;
      try {
        const days = await parseSessionFile(item.path, item.id);
        cache.set(item.path, { sig: item.sig, days });
      } catch {
        cache.delete(item.path);
      }
    }
  });
  await Promise.all(workers);

  const slices: FileDaySlice[][] = [];
  for (const s of queue) {
    const hit = cache.get(s.path);
    if (hit) slices.push(hit.days);
  }

  return {
    signature: sigParts.join("|"),
    data: { days: mergeSlices(slices), builtAt: Date.now() },
  };
}

async function getAggregate(forceRefresh: boolean): Promise<UsageAggregate> {
  const cache = globalThis.__piUsageCache;
  const now = Date.now();

  // Soft path: instant return while the user re-opens Usage within SOFT_TTL.
  if (!forceRefresh && cache && now - cache.at < SOFT_TTL_MS) {
    return cache.data;
  }

  // Hard path still valid and signature-checked only after soft TTL.
  if (!forceRefresh && cache && now - cache.at < HARD_TTL_MS) {
    // Fall through to rebuild check — but coalesce concurrent rebuilds.
  }

  if (!forceRefresh && globalThis.__piUsagePromise) return globalThis.__piUsagePromise;

  const promise = buildAggregate()
    .then(({ data, signature }) => {
      // If nothing changed and we already have data, keep previous builtAt soft window.
      const prev = globalThis.__piUsageCache;
      if (prev && prev.signature === signature && !forceRefresh) {
        globalThis.__piUsageCache = { signature, at: Date.now(), data: prev.data };
        return prev.data;
      }
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
    let messages = 0;
    let activeDays = 0;
    const rangeSessionIds = new Set<string>();
    const modelTotals = new Map<string, number>();

    for (const bucket of agg.days.values()) {
      if (bucket.date < startDate || bucket.date > today) continue;
      tokens += bucket.tokens;
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
