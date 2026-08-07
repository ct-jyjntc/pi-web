/**
 * Built-in free model providers shown under the "Free" group in ModelsConfig.
 *
 * Invariant:
 * - Provider `/models` ids are authoritative for membership.
 * - Metadata is minimal (id/name + DeepSeek compat); no remote catalog.
 * - User-owned: disabled + optional thinkingLevelMap across refresh.
 */

import { DEEPSEEK_COMPAT, isDeepSeekModelId } from "./deepseek-compat";
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
  /** OpenAI-completions compat (e.g. DeepSeek reasoning_content replay). */
  compat?: Record<string, unknown>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
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

/**
 * Build managed free-model entries from remote ids only (no external catalog).
 */
export function buildFreeModelEntries(
  def: FreeProviderDefinition,
  modelIds: readonly string[],
): FreeModelEntry[] {
  return filterFreeModelIds(def, modelIds).map((id) =>
    applyDeepSeekCompat({ id, name: id }),
  );
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
      name: item.name !== item.id ? item.name : (prev?.name?.trim() || item.name),
    };
    // Drop legacy cost if present on previous models.json entries.
    delete (next as { cost?: unknown }).cost;
    delete (next as { thinkingMapLocked?: unknown }).thinkingMapLocked;
    if (prev?.disabled && item.disabled === undefined) next.disabled = true;
    else if (item.disabled === undefined) delete next.disabled;
    // Keep previous thinking map when the free list only returns ids.
    if (item.thinkingLevelMap) {
      next.thinkingLevelMap = { ...item.thinkingLevelMap };
    } else if (prev?.thinkingLevelMap) {
      next.thinkingLevelMap = { ...prev.thinkingLevelMap };
    } else {
      delete next.thinkingLevelMap;
    }
    return applyDeepSeekCompat(next);
  });
}
