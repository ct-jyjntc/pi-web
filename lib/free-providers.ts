/**
 * Built-in free model providers shown under the "Free" group in ModelsConfig.
 *
 * Invariant:
 * - Provider `/models` ids are authoritative for membership (models.dev never blocks ids).
 * - Official models.dev thinkingLevelMap locks user edits (thinkingMapLocked).
 * - Without official map, user thinkingLevelMap is kept across refresh.
 */

import { DEEPSEEK_COMPAT, isDeepSeekModelId } from "./deepseek-compat";
import { normalizeModelCost } from "./model-cost";
import {
  recommendModelCatalogPreset,
  type ModelCatalogEntry,
  type ModelCatalogPreset,
} from "./model-catalog";
import type { ThinkingLevelMap } from "./thinking-level-map";

export type FreeProviderId = "opencode-zen-free";

export interface FreeProviderDefinition {
  /** Stable managed marker stored on models.json provider entries. */
  id: FreeProviderId;
  /** Key used under models.json `providers`. */
  providerKey: string;
  displayName: string;
  description: string;
  baseUrl: string;
  api: "openai-completions";
  /** API key used for auth. OpenCode Zen free tier uses the public key. */
  apiKey: string;
  /** Only keep model ids matching this predicate (e.g. free-tier suffix). */
  modelIdFilter: (modelId: string) => boolean;
  /** models.dev provider id used for metadata enrichment. */
  catalogProviderId: string;
  /** Icon key for ProviderIcon / lobehub icons. */
  iconId: string;
}

/** Official free-model fields written into models.json (toggle-only for users). */
export interface FreeModelEntry {
  id: string;
  name: string;
  /** User-owned enable/disable flag; only field free models keep across refresh. */
  disabled?: boolean;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  /** True when thinkingLevelMap came from official catalog (not user-editable). */
  thinkingMapLocked?: boolean;
  /** OpenAI-completions compat (e.g. DeepSeek reasoning_content replay). */
  compat?: Record<string, unknown>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

export const FREE_PROVIDERS: readonly FreeProviderDefinition[] = [
  {
    id: "opencode-zen-free",
    providerKey: "opencode-zen",
    displayName: "OpenCode Zen",
    description: "Free models via opencode.ai/zen",
    baseUrl: "https://opencode.ai/zen/v1",
    api: "openai-completions",
    apiKey: "public",
    modelIdFilter: (modelId) => modelId.endsWith("-free"),
    catalogProviderId: "opencode",
    iconId: "opencode",
  },
] as const;

export function getFreeProvider(id: string | undefined | null): FreeProviderDefinition | undefined {
  if (!id) return undefined;
  return FREE_PROVIDERS.find((p) => p.id === id);
}

export function isFreeManagedProvider<T extends { managed?: unknown }>(
  provider: T | null | undefined,
): provider is T & { managed: FreeProviderId } {
  return !!provider && typeof provider.managed === "string" && !!getFreeProvider(provider.managed);
}

export function freeProviderByKey(providerKey: string): FreeProviderDefinition | undefined {
  return FREE_PROVIDERS.find((p) => p.providerKey === providerKey);
}

export function filterFreeModelIds(
  def: FreeProviderDefinition,
  modelIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of modelIds) {
    const id = raw.trim();
    if (!id || !def.modelIdFilter(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function applyDeepSeekCompat(entry: FreeModelEntry): FreeModelEntry {
  if (!isDeepSeekModelId(entry.id)) return entry;
  return {
    ...entry,
    compat: {
      ...(entry.compat ?? {}),
      ...DEEPSEEK_COMPAT,
    },
  };
}

function applyCatalogPreset(id: string, preset: ModelCatalogPreset): FreeModelEntry {
  const entry: FreeModelEntry = {
    id,
    name: preset.name?.trim() || id,
  };
  if (preset.reasoning !== undefined) entry.reasoning = preset.reasoning;
  if (preset.thinkingLevelMap) {
    entry.thinkingLevelMap = { ...preset.thinkingLevelMap };
    entry.thinkingMapLocked = true;
  }
  if (preset.input?.length) entry.input = [...preset.input];
  if (preset.contextWindow !== undefined) entry.contextWindow = preset.contextWindow;
  if (preset.maxTokens !== undefined) entry.maxTokens = preset.maxTokens;
  if (preset.cost) entry.cost = normalizeModelCost(preset.cost);
  return applyDeepSeekCompat(entry);
}

/**
 * Build managed free-model entries from remote ids + models.dev catalog.
 * Catalog lookup prefers the free provider's catalogProviderId / baseUrl.
 */
export function buildFreeModelEntries(
  def: FreeProviderDefinition,
  modelIds: readonly string[],
  catalog: readonly ModelCatalogEntry[] = [],
): FreeModelEntry[] {
  return filterFreeModelIds(def, modelIds).map((id) => {
    if (catalog.length === 0) {
      return applyDeepSeekCompat({ id, name: id });
    }
    const recommendation = recommendModelCatalogPreset(
      catalog,
      id,
      def.catalogProviderId,
      def.baseUrl,
    );
    return applyCatalogPreset(id, recommendation.preset);
  });
}

/**
 * Merge remote free catalog entries into models.json entries.
 * Missing catalog fields preserve the last known value during partial/degraded
 * responses; the remote provider still owns membership and supplied fields.
 */
export function mergeFreeModelEntries(
  existing: ReadonlyArray<Partial<FreeModelEntry> & { id: string }> | undefined,
  fetched: readonly FreeModelEntry[],
): FreeModelEntry[] {
  const prevById = new Map((existing ?? []).map((m) => [m.id, m]));
  return fetched.map((item) => {
    const prev = prevById.get(item.id);
    const next: FreeModelEntry = {
      ...prev,
      ...item,
      // Prefer official display name; fall back to any previous name when the
      // catalog only knows the model id.
      name: item.name !== item.id ? item.name : (prev?.name?.trim() || item.name),
      cost: normalizeModelCost(item.cost ?? prev?.cost),
    };
    if (prev?.disabled && item.disabled === undefined) next.disabled = true;
    else if (item.disabled === undefined) delete next.disabled;
    // Official catalog map always wins; otherwise keep the previous map but
    // make it editable because the current response supplied no official map.
    if (item.thinkingLevelMap) {
      next.thinkingLevelMap = { ...item.thinkingLevelMap };
      next.thinkingMapLocked = true;
    } else if (prev?.thinkingLevelMap) {
      next.thinkingLevelMap = { ...prev.thinkingLevelMap };
      delete next.thinkingMapLocked;
    } else {
      delete next.thinkingLevelMap;
      delete next.thinkingMapLocked;
    }
    return applyDeepSeekCompat(next);
  });
}
