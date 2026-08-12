/**
 * Soft client cache of GET /api/models so ChatWindow remounts (session switch)
 * can resolve display names on first paint instead of flashing the raw model id.
 */

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  supportsImage?: boolean;
};

export type ModelCatalogSnapshot = {
  names: Record<string, string>;
  list: ModelCatalogEntry[];
  error: string | null;
  scopeWarnings: string[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  thinkingLevelPins: Record<string, string>;
  imageSupport: Record<string, boolean>;
};

const CACHE = new Map<string, { snap: ModelCatalogSnapshot; at: number }>();
const TTL_MS = 10 * 60 * 1000;
const MAX = 8;

export function catalogCacheKey(cwd: string | null | undefined): string {
  return cwd?.trim() || "";
}

export function readModelCatalogCache(cwd: string | null | undefined): ModelCatalogSnapshot | null {
  const key = catalogCacheKey(cwd);
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.snap;
}

export function writeModelCatalogCache(cwd: string | null | undefined, snap: ModelCatalogSnapshot): void {
  const key = catalogCacheKey(cwd);
  CACHE.set(key, { snap, at: Date.now() });
  while (CACHE.size > MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}
