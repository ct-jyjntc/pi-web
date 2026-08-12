/**
 * Disk cache for built-in (OAuth / API-key) provider model catalogs.
 *
 * SDK-free on purpose so Settings can open from the light runtime:
 * - Default read: ~/.pi/agent/builtin-provider-models-cache.json
 * - Network/SDK refresh only when the user clicks "Refresh models" (?fresh=1)
 *
 * Disabled flags are NOT the source of truth here — re-applied from
 * disabled-models.json on every read so toggles stay instant (light).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "./agent-dir";
import { getDisabledModelRefs } from "./disabled-models";
import type { BuiltinProviderModelRow } from "./builtin-provider-models";

const CACHE_VERSION = 1;

export type CachedBuiltinProviderModels = {
  displayName?: string;
  updatedAt: number;
  /** Catalog rows; `disabled` is re-applied from denylist on read. */
  models: BuiltinProviderModelRow[];
};

type CacheFile = {
  version: number;
  providers: Record<string, CachedBuiltinProviderModels>;
};

function cachePath(override?: string): string {
  return override ?? join(getAgentDir(), "builtin-provider-models-cache.json");
}

function emptyFile(): CacheFile {
  return { version: CACHE_VERSION, providers: {} };
}

function readFile(path: string): CacheFile {
  if (!existsSync(path)) return emptyFile();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<CacheFile>;
    if (!raw || typeof raw !== "object" || raw.version !== CACHE_VERSION) return emptyFile();
    if (!raw.providers || typeof raw.providers !== "object") return emptyFile();
    return { version: CACHE_VERSION, providers: raw.providers };
  } catch {
    return emptyFile();
  }
}

function writeFileAtomic(path: string, data: CacheFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function stripDisabled(models: BuiltinProviderModelRow[]): BuiltinProviderModelRow[] {
  return models.map((m) => ({
    ...m,
    disabled: false,
  }));
}

function applyDisabled(
  provider: string,
  models: BuiltinProviderModelRow[],
  disabledRefs?: Set<string>,
): BuiltinProviderModelRow[] {
  const disabled = disabledRefs ?? getDisabledModelRefs();
  return models.map((m) => ({
    ...m,
    disabled: disabled.has(`${provider}/${m.id}`),
  }));
}

/** Read one provider's cached catalog (light-safe). */
export function readBuiltinProviderModelsCache(
  provider: string,
  options?: { path?: string },
): CachedBuiltinProviderModels | null {
  const id = provider.trim();
  if (!id) return null;
  const file = readFile(cachePath(options?.path));
  const entry = file.providers[id];
  if (!entry || !Array.isArray(entry.models)) return null;
  return {
    displayName: entry.displayName,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
    models: applyDisabled(id, entry.models),
  };
}

function asPositiveWindow(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Cheap contextWindow lookup for cold-open estimates.
 * Does not apply disabled flags and does not start ModelRuntime.
 */
export function resolveCachedModelContextWindow(
  provider: string,
  modelId: string,
  options?: { path?: string },
): number | null {
  const id = provider.trim();
  const mid = modelId.trim();
  if (!id || !mid) return null;
  const file = readFile(cachePath(options?.path));
  const entry = file.providers[id]
    ?? Object.entries(file.providers).find(([key]) => key.toLowerCase() === id.toLowerCase())?.[1];
  if (!entry?.models?.length) return null;
  const found = entry.models.find((model) =>
    model.id === mid
    || (typeof model.id === "string" && model.id.toLowerCase() === mid.toLowerCase())
  );
  return asPositiveWindow(found?.contextWindow);
}

/** Persist a provider catalog after a successful live refresh (heavy path). */
export function writeBuiltinProviderModelsCache(
  provider: string,
  payload: {
    displayName?: string;
    models: BuiltinProviderModelRow[];
  },
  options?: { path?: string },
): void {
  const id = provider.trim();
  if (!id) return;
  const path = cachePath(options?.path);
  const file = readFile(path);
  file.providers[id] = {
    displayName: payload.displayName,
    updatedAt: Date.now(),
    models: stripDisabled(payload.models),
  };
  writeFileAtomic(path, file);
}

/** Drop one provider from the cache (e.g. after disconnect). */
export function clearBuiltinProviderModelsCache(
  provider: string,
  options?: { path?: string },
): void {
  const id = provider.trim();
  if (!id) return;
  const path = cachePath(options?.path);
  const file = readFile(path);
  if (!(id in file.providers)) return;
  delete file.providers[id];
  writeFileAtomic(path, file);
}
