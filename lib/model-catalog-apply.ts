/**
 * Apply models.dev catalog presets onto model entries.
 * Official lock only when model id matches AND the provider name or base URL
 * ties to models.dev — bare model-id consensus (custom endpoints) stays editable.
 */
import { normalizeModelCost, type ModelCost } from "./model-cost";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "./model-catalog";
import {
  sameThinkingLevelMap,
  type ThinkingLevelMap,
} from "./thinking-level-map";

/** Subset of model fields owned by models.dev when an exact match exists. */
export type CatalogOwnedModelFields = {
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

/**
 * Whether official fields should be auto-applied and locked.
 * Requires an exact model id hit plus provider-name or base-URL ownership.
 * Consensus-only (same id on unrelated providers) is not managed — custom
 * endpoints stay fully editable.
 */
export function isCatalogExactMatch(
  recommendation: Pick<ModelCatalogRecommendation, "exactMatches" | "metadataMethod"> | null | undefined,
): boolean {
  if (!recommendation || recommendation.exactMatches <= 0) return false;
  return recommendation.metadataMethod === "provider"
    || recommendation.metadataMethod === "base-url";
}


function sameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameCost(
  a: CatalogOwnedModelFields["cost"] | undefined,
  b: ModelCost | undefined,
): boolean {
  const left = normalizeModelCost(a ?? null);
  const right = normalizeModelCost(b ?? null);
  return left.input === right.input
    && left.output === right.output
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite;
}

/**
 * Overwrite official fields from a models.dev exact-match preset.
 * Leaves id/api/compat/disabled untouched.
 */
export function applyOfficialCatalogFields<T extends CatalogOwnedModelFields>(
  model: T,
  preset: ModelCatalogPreset,
): { model: T; appliedCount: number; changed: boolean } {
  const next: T = { ...model };
  let appliedCount = 0;

  if (preset.name?.trim() && model.name?.trim() !== preset.name.trim()) {
    next.name = preset.name.trim();
    appliedCount += 1;
  }

  if (preset.reasoning === true) {
    if (model.reasoning !== true) {
      next.reasoning = true;
      appliedCount += 1;
    }
  } else if (preset.reasoning === false && model.reasoning === true) {
    delete (next as CatalogOwnedModelFields).reasoning;
    appliedCount += 1;
  }

  // Official catalog map overwrites (identified → locked in UI).
  // No official map → leave user's customization alone.
  if (preset.thinkingLevelMap) {
    if (!sameThinkingLevelMap(model.thinkingLevelMap, preset.thinkingLevelMap)) {
      next.thinkingLevelMap = { ...preset.thinkingLevelMap };
      appliedCount += 1;
    }
  }

  if (preset.input?.length) {
    if (!sameStringArray(model.input, preset.input)) {
      next.input = [...preset.input];
      appliedCount += 1;
    }
  }

  if (preset.contextWindow !== undefined && model.contextWindow !== preset.contextWindow) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }

  if (preset.maxTokens !== undefined && model.maxTokens !== preset.maxTokens) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }

  if (preset.cost) {
    const cost = normalizeModelCost({
      input: preset.cost.input,
      output: preset.cost.output,
      cacheRead: preset.cost.cacheRead,
      cacheWrite: preset.cost.cacheWrite,
    });
    if (!sameCost(model.cost, cost)) {
      next.cost = cost;
      appliedCount += 1;
    }
  }

  return { model: next, appliedCount, changed: appliedCount > 0 };
}
