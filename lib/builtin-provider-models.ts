/**
 * Built-in (API-key / OAuth) provider model list projection + override writes.
 *
 * Invariant (single rule):
 * 1. Official runtime `thinkingLevelMap` locks user customization (not editable; PUT rejected).
 * 2. User overrides apply only when official map is absent.
 * 3. Settings catalog refresh is owned by `builtin-provider-models-fresh.ts`
 *    (one provider, local-only — never pi.dev fan-out).
 */
import type { ModelOverrideFields } from "./model-overrides";
import { getModelOverride, setModelOverride } from "./model-overrides";
import { isSoftField } from "./subscription-oauth-shared";
import { readBuiltinProviderModelsCache } from "./builtin-provider-models-cache";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type BuiltinProviderModelRow = {
  id: string;
  name: string;
  reasoning: boolean;
  /** True when the runtime did not identify reasoning support. */
  reasoningEditable: boolean;
  supportsImage: boolean;
  disabled: boolean;
  contextWindow?: number;
  /** True when contextWindow is user-supplied or missing from the runtime. */
  contextWindowEditable: boolean;
  maxTokens?: number;
  /** True when maxTokens is user-supplied or missing from the runtime. */
  maxTokensEditable: boolean;
  input?: string[];
  thinkingLevelMap?: Record<string, string | null>;
  /** false when official runtime map is present. */
  thinkingMapEditable?: boolean;
};

type RuntimeModelLike = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: unknown;
  contextWindow?: unknown;
  maxTokens?: unknown;
  thinkingLevelMap?: unknown;
};

/**
 * Local-only runtime recompose for one settings path.
 * Does NOT call allowNetwork:true (that fan-out hits pi.dev for every builtin).
 *
 * @returns always false (`live` remote catalog) — local projection only.
 */
export async function refreshBuiltinProviderModels(
  modelRuntime: ModelRuntime,
  provider: string,
  options?: { signal?: AbortSignal },
): Promise<boolean> {
  try {
    await modelRuntime.refresh({ allowNetwork: false, signal: options?.signal });
  } catch (error) {
    console.warn(
      `[provider-models] local refresh failed for ${provider}; using current snapshot`,
      error,
    );
  }
  return false;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function officialThinkingMap(
  m: RuntimeModelLike,
): Record<string, string | null> | undefined {
  if (!m.thinkingLevelMap || typeof m.thinkingLevelMap !== "object" || Array.isArray(m.thinkingLevelMap)) {
    return undefined;
  }
  const map = m.thinkingLevelMap as Record<string, string | null>;
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Project one runtime model into a UI row (disabled + override merge). */
export function projectBuiltinProviderModel(
  provider: string,
  m: RuntimeModelLike,
  disabled: boolean,
): BuiltinProviderModelRow {
  const override = getModelOverride(provider, m.id);
  // Per-field: vendor-locked fields are not soft → not editable.
  const softReasoning = isSoftField(provider, m.id, "reasoning");
  const softCtx = isSoftField(provider, m.id, "contextWindow");
  const softMax = isSoftField(provider, m.id, "maxTokens");
  const softThinking = isSoftField(provider, m.id, "thinkingLevelMap");

  const hasReasoning = typeof m.reasoning === "boolean";
  const officialReasoning = !softReasoning && hasReasoning ? m.reasoning : undefined;
  const officialContextWindow = !softCtx ? asPositiveNumber(m.contextWindow) : undefined;
  const officialMaxTokens = !softMax ? asPositiveNumber(m.maxTokens) : undefined;

  const row: BuiltinProviderModelRow = {
    id: m.id,
    name: m.name || m.id,
    reasoning: override?.reasoning ?? (hasReasoning ? Boolean(m.reasoning) : false),
    reasoningEditable: softReasoning || !hasReasoning,
    supportsImage: Array.isArray(m.input) && m.input.includes("image"),
    disabled,
    contextWindowEditable: softCtx || asPositiveNumber(m.contextWindow) === undefined,
    maxTokensEditable: softMax || asPositiveNumber(m.maxTokens) === undefined,
  };

  if (officialContextWindow !== undefined) row.contextWindow = officialContextWindow;
  else if (override?.contextWindow !== undefined) row.contextWindow = override.contextWindow;
  else if (asPositiveNumber(m.contextWindow) !== undefined) row.contextWindow = asPositiveNumber(m.contextWindow);

  if (officialMaxTokens !== undefined) row.maxTokens = officialMaxTokens;
  else if (override?.maxTokens !== undefined) row.maxTokens = override.maxTokens;
  else if (asPositiveNumber(m.maxTokens) !== undefined) row.maxTokens = asPositiveNumber(m.maxTokens);

  if (Array.isArray(m.input) && m.input.length) {
    const input = m.input.map(String).filter(Boolean);
    if (input.length) row.input = input;
  }

  const runtimeMap = officialThinkingMap(m);
  if (!softThinking && runtimeMap) {
    row.thinkingLevelMap = { ...runtimeMap };
    row.thinkingMapEditable = false;
  } else {
    row.thinkingMapEditable = true;
    if (override?.thinkingLevelMap) row.thinkingLevelMap = { ...override.thinkingLevelMap };
    else if (runtimeMap) row.thinkingLevelMap = { ...runtimeMap };
  }

  return row;
}

export type BuiltinOverrideWriteResult =
  | { ok: true; override: ModelOverrideFields }
  | { ok: false; error: string; status: number };

/**
 * Validate + write user overrides.
 * Prefer persisted *Editable flags from the provider-models cache (survives process
 * restarts). Fall back to in-memory soft-field flags from the current materialize.
 */
export function writeBuiltinModelOverride(
  provider: string,
  modelId: string,
  runtimeModel: RuntimeModelLike,
  body: {
    thinkingLevelMap?: unknown;
    reasoning?: unknown;
    contextWindow?: unknown;
    maxTokens?: unknown;
  },
): BuiltinOverrideWriteResult {
  const cached = readBuiltinProviderModelsCache(provider)?.models.find((m) => m.id === modelId);

  const thinkingEditable =
    cached?.thinkingMapEditable !== undefined
      ? cached.thinkingMapEditable !== false
      : isSoftField(provider, modelId, "thinkingLevelMap") || !officialThinkingMap(runtimeModel);
  const reasoningEditable =
    cached?.reasoningEditable !== undefined
      ? cached.reasoningEditable !== false
      : isSoftField(provider, modelId, "reasoning") || typeof runtimeModel.reasoning !== "boolean";
  const contextEditable =
    cached?.contextWindowEditable !== undefined
      ? cached.contextWindowEditable !== false
      : isSoftField(provider, modelId, "contextWindow")
        || asPositiveNumber(runtimeModel.contextWindow) === undefined;
  const maxEditable =
    cached?.maxTokensEditable !== undefined
      ? cached.maxTokensEditable !== false
      : isSoftField(provider, modelId, "maxTokens")
        || asPositiveNumber(runtimeModel.maxTokens) === undefined;

  if (!thinkingEditable && body.thinkingLevelMap !== undefined) {
    return { ok: false, error: "Official thinking map is locked for this model", status: 400 };
  }
  if (!reasoningEditable && body.reasoning !== undefined) {
    return { ok: false, error: "Official reasoning metadata is locked for this model", status: 400 };
  }
  if (!contextEditable && body.contextWindow !== undefined) {
    return { ok: false, error: "Official context window is locked for this model", status: 400 };
  }
  if (!maxEditable && body.maxTokens !== undefined) {
    return { ok: false, error: "Official max output is locked for this model", status: 400 };
  }

  const patch: ModelOverrideFields = {};
  if (body.thinkingLevelMap && typeof body.thinkingLevelMap === "object" && !Array.isArray(body.thinkingLevelMap)) {
    patch.thinkingLevelMap = body.thinkingLevelMap as Record<string, string | null>;
  }
  if (typeof body.reasoning === "boolean") patch.reasoning = body.reasoning;
  const contextWindow = asPositiveNumber(body.contextWindow);
  const maxTokens = asPositiveNumber(body.maxTokens);
  if (contextWindow !== undefined) patch.contextWindow = contextWindow;
  if (maxTokens !== undefined) patch.maxTokens = maxTokens;

  const saved = setModelOverride(provider, modelId, patch);
  return { ok: true, override: saved };
}
