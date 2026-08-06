/**
 * Single owner for models.dev catalog fetch + in-process cache.
 *
 * Invariant:
 * - One recovery path: fresh cache → live fetch → stale cache → source:"none".
 * - Callers never invent a second try/catch empty array; they read `source`.
 * - Free-model ids must still list when source is "none" (enrichment optional).
 */
import {
  flattenModelsDevCatalog,
  type ModelCatalogEntry,
} from "./model-catalog";

/**
 * models.dev catalog URL.
 * Official `https://models.dev/api.json` is often blocked in CN; use the
 * rainflowtb mirror (same JSON shape, `X-Mirror-Upstream: https://models.dev`).
 */
export const MODELS_DEV_URL = "https://models.rainflowtb.com/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
// Catalog is ~3.5MB. Mirror is reachable (~1s typical); keep a modest ceiling
// so a dead network cannot block free-models / settings for tens of seconds.
const FETCH_TIMEOUT_MS = 12_000;

export type ModelsDevCatalogSource = "live" | "cache" | "stale" | "none";

export type ModelsDevCatalogLoad = {
  entries: ModelCatalogEntry[];
  source: ModelsDevCatalogSource;
};

interface CatalogCache {
  entries: ModelCatalogEntry[];
  expiresAt: number;
  inFlight?: Promise<ModelCatalogEntry[]>;
}

declare global {
  // Survives Next.js hot-reload; plain module Map does not.
  var __piModelsDevCatalogCache: CatalogCache | undefined;
}

function getCache(): CatalogCache {
  return globalThis.__piModelsDevCatalogCache ??= { entries: [], expiresAt: 0 };
}

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  const response = await fetch(MODELS_DEV_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`models catalog returned HTTP ${response.status} (${MODELS_DEV_URL})`);
  }
  const entries = flattenModelsDevCatalog(await response.json());
  if (entries.length === 0) {
    throw new Error(`models catalog returned an empty body (${MODELS_DEV_URL})`);
  }
  return entries;
}

/**
 * Load models.dev entries with explicit source.
 * Never throws for transport failure when a prior cache exists (returns stale).
 * Returns source:"none" + [] only when nothing is available — single soft-fail.
 */
export async function loadModelsDevCatalogDetailed(): Promise<ModelsDevCatalogLoad> {
  const cache = getCache();
  if (cache.entries.length > 0 && cache.expiresAt > Date.now()) {
    return { entries: cache.entries, source: "cache" };
  }

  if (!cache.inFlight) {
    cache.inFlight = fetchCatalog().then((entries) => {
      cache.entries = entries;
      cache.expiresAt = Date.now() + CATALOG_TTL_MS;
      return entries;
    }).finally(() => {
      cache.inFlight = undefined;
    });
  }

  try {
    const entries = await cache.inFlight;
    return { entries, source: "live" };
  } catch (error) {
    if (cache.entries.length > 0) {
      console.warn("[models-dev-catalog] live fetch failed; serving stale cache", error);
      return { entries: cache.entries, source: "stale" };
    }
    console.warn("[models-dev-catalog] unavailable (no cache)", error);
    return { entries: [], source: "none" };
  }
}

/** Entries only (catalog search route). Throws when nothing available. */
export async function loadModelsDevCatalog(): Promise<ModelCatalogEntry[]> {
  const load = await loadModelsDevCatalogDetailed();
  if (load.source === "none") {
    throw new Error("models.dev catalog unavailable");
  }
  return load.entries;
}
