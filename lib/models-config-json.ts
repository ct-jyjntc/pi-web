/**
 * Single owner for reading/writing ~/.pi/agent/models.json: atomic file IO,
 * legacy-field stripping, developer-role normalization, and provider-level
 * upsert/delete. Route handlers under app/api/models-config/** call this
 * instead of touching models.json directly.
 */
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@/lib/agent-dir";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";
import { normalizeDeveloperRoleCompat } from "@/lib/developer-role-compat";

export function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

export type ReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export function readModelsJson(): ReadResult {
  const path = getModelsPath();
  if (!existsSync(path)) return { ok: true, data: { providers: {} } };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Strip legacy cost / catalog-lock fields from a single provider entry. */
function stripProviderLegacyBilling(provider: Record<string, unknown>): Record<string, unknown> {
  const next = { ...provider };
  const models = next.models;
  if (Array.isArray(models)) {
    next.models = models.map((rawModel) => {
      if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) return rawModel;
      const model = { ...(rawModel as Record<string, unknown>) };
      delete model.cost;
      delete model.thinkingMapLocked;
      return model;
    });
  }
  return next;
}

/** Strip legacy cost / catalog-lock fields from all providers in a models.json object. */
export function stripLegacyModelBilling(data: Record<string, unknown>): Record<string, unknown> {
  const providers = data.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return data;
  const nextProviders: Record<string, unknown> = {};
  for (const [name, rawProvider] of Object.entries(providers as Record<string, unknown>)) {
    if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) {
      nextProviders[name] = rawProvider;
      continue;
    }
    nextProviders[name] = stripProviderLegacyBilling(rawProvider as Record<string, unknown>);
  }
  return { ...data, providers: nextProviders };
}

export function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Normalize a whole models.json object before a full-file write. */
export function normalizeModelsJson(data: Record<string, unknown>): Record<string, unknown> {
  return normalizeDeveloperRoleCompat(stripLegacyModelBilling(data));
}

/** Drop caches after any models.json mutation so the next read sees it. */
export async function invalidateAfterModelsChange(): Promise<void> {
  invalidateModelsCache();
  try {
    const { invalidateUtilityModelRuntimes } = await import("@/lib/utility-model");
    invalidateUtilityModelRuntimes();
  } catch {
    // Light runtime has no utility-model graph; heavy will rebuild on next use.
  }
}

export type ProviderEntry = Record<string, unknown>;

export type UpsertResult = { ok: true } | { ok: false; error: string };

/**
 * Atomically upsert one provider entry into models.json. Only the touched
 * provider is re-stripped of legacy billing fields; the rest of the file is
 * untouched on disk (already normalized by the last full write).
 */
export function upsertProvider(name: string, entry: ProviderEntry): UpsertResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "provider name is required" };
  const read = readModelsJson();
  if (!read.ok) return { ok: false, error: read.error };
  const data = read.data;
  const providers =
    data.providers && typeof data.providers === "object" && !Array.isArray(data.providers)
      ? { ...(data.providers as Record<string, unknown>) }
      : {};
  providers[trimmed] = stripProviderLegacyBilling(entry);
  data.providers = providers;
  writeModelsJson(data);
  return { ok: true };
}

export type DeleteResult = { ok: true; existed: boolean } | { ok: false; error: string };

/** Atomically remove one provider from models.json. No-op if absent. */
export function deleteProviderEntry(name: string): DeleteResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "provider name is required" };
  const read = readModelsJson();
  if (!read.ok) return { ok: false, error: read.error };
  const data = read.data;
  const providers =
    data.providers && typeof data.providers === "object" && !Array.isArray(data.providers)
      ? { ...(data.providers as Record<string, unknown>) }
      : {};
  const existed = Object.prototype.hasOwnProperty.call(providers, trimmed);
  if (existed) {
    delete providers[trimmed];
    data.providers = providers;
    writeModelsJson(data);
  }
  return { ok: true, existed };
}
