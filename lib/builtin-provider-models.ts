/**
 * Built-in (API-key / OAuth) provider model list projection + override writes.
 *
 * Invariant (single rule):
 * 1. Official runtime `thinkingLevelMap` locks user customization (not editable; PUT rejected).
 * 2. User overrides apply only when official map is absent.
 * 3. List refresh is one path: try live refresh → always report `live: boolean`; never silent empty catch in routes.
 */
import type { ModelOverrideFields } from "./model-overrides";
import { getModelOverride, setModelOverride } from "./model-overrides";

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
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
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
  cost?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
  thinkingLevelMap?: unknown;
};

/** Refresh the runtime catalog used by every built-in model mutation route. */
export async function refreshBuiltinProviderModels(
  modelRuntime: ModelRuntime,
  provider: string,
): Promise<boolean> {
  try {
    await modelRuntime.refresh({ allowNetwork: true });
    return true;
  } catch (error) {
    // Keep the registered catalog/store available when live refresh fails.
    console.warn(`[provider-models] refresh failed for ${provider}; using last store`, error);
    return false;
  }
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
  const officialReasoning = typeof m.reasoning === "boolean" ? m.reasoning : undefined;
  const officialContextWindow = asPositiveNumber(m.contextWindow);
  const officialMaxTokens = asPositiveNumber(m.maxTokens);
  const row: BuiltinProviderModelRow = {
    id: m.id,
    name: m.name || m.id,
    reasoning: officialReasoning ?? override?.reasoning ?? false,
    reasoningEditable: officialReasoning === undefined,
    supportsImage: Array.isArray(m.input) && m.input.includes("image"),
    disabled,
    contextWindowEditable: officialContextWindow === undefined,
    maxTokensEditable: officialMaxTokens === undefined,
  };

  if (officialContextWindow !== undefined) row.contextWindow = officialContextWindow;
  else if (override?.contextWindow !== undefined) row.contextWindow = override.contextWindow;
  if (officialMaxTokens !== undefined) row.maxTokens = officialMaxTokens;
  else if (override?.maxTokens !== undefined) row.maxTokens = override.maxTokens;

  if (Array.isArray(m.input) && m.input.length) {
    const input = m.input.map(String).filter(Boolean);
    if (input.length) row.input = input;
  }

  if (m.cost && typeof m.cost === "object") {
    row.cost = {
      input: typeof m.cost.input === "number" ? m.cost.input : undefined,
      output: typeof m.cost.output === "number" ? m.cost.output : undefined,
      cacheRead: typeof m.cost.cacheRead === "number" ? m.cost.cacheRead : undefined,
      cacheWrite: typeof m.cost.cacheWrite === "number" ? m.cost.cacheWrite : undefined,
    };
  }

  const officialMap = officialThinkingMap(m);
  if (officialMap) {
    row.thinkingLevelMap = { ...officialMap };
    row.thinkingMapEditable = false;
  } else {
    row.thinkingMapEditable = true;
    if (override?.thinkingLevelMap) row.thinkingLevelMap = { ...override.thinkingLevelMap };
  }

  return row;
}

export type BuiltinOverrideWriteResult =
  | { ok: true; override: ModelOverrideFields }
  | { ok: false; error: string; status: number };

/** Validate + write user overrides. Official metadata → reject. */
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
  const officialMap = officialThinkingMap(runtimeModel);
  if (officialMap && body.thinkingLevelMap !== undefined) {
    return { ok: false, error: "Official thinking map is locked for this model", status: 400 };
  }
  if (typeof runtimeModel.reasoning === "boolean" && body.reasoning !== undefined) {
    return { ok: false, error: "Official reasoning metadata is locked for this model", status: 400 };
  }
  if (asPositiveNumber(runtimeModel.contextWindow) !== undefined && body.contextWindow !== undefined) {
    return { ok: false, error: "Official context window is locked for this model", status: 400 };
  }
  if (asPositiveNumber(runtimeModel.maxTokens) !== undefined && body.maxTokens !== undefined) {
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
