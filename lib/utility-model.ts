import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";
import {
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { filterDisabledModels, getDisabledModelRefs } from "./disabled-models";
import { formatModelRef, type ModelRef } from "./web-settings";

/** Values commonly accepted by OpenAI-compatible reasoning_effort fields. */
const API_SAFE_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

const THINKING_LEVEL_ORDER: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Lowest supported thinking level for utility tasks (title / commit message).
 * Prefers off/none when available; skips misconfigured maps like off→"off".
 */
export function pickLowestThinkingLevel(model: Model<string> | null | undefined): ModelThinkingLevel {
  if (!model) return "off";
  if (!model.reasoning) return "off";

  const supported = new Set(getSupportedThinkingLevels(model));
  for (const level of THINKING_LEVEL_ORDER) {
    if (!supported.has(level)) continue;
    const mapped = model.thinkingLevelMap?.[level];
    // null = explicitly unsupported (should already be filtered, keep defensive).
    if (mapped === null) continue;
    if (level === "off") {
      // Unset map → provider default / omit is fine.
      if (mapped === undefined) return "off";
      if (typeof mapped === "string" && API_SAFE_REASONING_EFFORTS.has(mapped)) return "off";
      // e.g. misconfigured "off"→"off" — skip so we can fall through to low/medium.
      continue;
    }
    if (mapped === undefined) return level;
    if (typeof mapped === "string") {
      // Prefer mapped wire values that APIs accept; otherwise accept known pi levels.
      if (API_SAFE_REASONING_EFFORTS.has(mapped) || API_SAFE_REASONING_EFFORTS.has(level)) {
        return level;
      }
      continue;
    }
    return level;
  }

  return getSupportedThinkingLevels(model)[0] ?? "off";
}

/**
 * completeSimple only accepts ThinkingLevel (no "off").
 * When the lowest level is off/none, omit reasoning so the runtime sends thinkingLevelMap.off.
 */
export function pickUtilityCompleteReasoning(
  model: Model<string> | null | undefined,
): ThinkingLevel | undefined {
  if (!model?.reasoning) return undefined;
  const lowest = pickLowestThinkingLevel(model);
  if (lowest === "off") return undefined;
  return lowest;
}

export type UtilityModelOption = {
  provider: string;
  modelId: string;
  name: string;
};

function stripThinkingSuffix(modelRef: string): string {
  const trimmed = modelRef.trim();
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return trimmed;
  const suffix = trimmed.slice(colonIndex + 1);
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(suffix)) {
    return trimmed.slice(0, colonIndex);
  }
  return trimmed;
}

function filterEnabledModels<T extends { id: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[] | undefined,
): readonly T[] {
  if (!enabledModels || enabledModels.length === 0) return available;
  const refs = new Set(enabledModels.map(stripThinkingSuffix).filter(Boolean));
  const visible = available.filter((m) => refs.has(`${m.provider}/${m.id}`) || refs.has(m.id));
  return visible.length > 0 ? visible : available;
}

type ModelRuntimeLike = {
  getAvailable: (providerId?: string) => Promise<readonly Model<string>[]>;
  getModel: (providerId: string, modelId: string) => Model<string> | undefined;
  completeSimple: (...args: never[]) => Promise<unknown>;
};

export type ResolvedUtilityModel = {
  model: Model<string>;
  source: "preferred" | "default" | "first";
  ref: ModelRef;
  /** Live runtime used to resolve auth + complete the request. */
  modelRuntime: ModelRuntimeLike;
};

type ModelRuntimeBundle = {
  modelRuntime: ModelRuntimeLike;
  settings: SettingsManager;
};

type ModelRuntimeCacheState = {
  entries: Map<string, { bundle: ModelRuntimeBundle; expiresAt: number }>;
  inFlight: Map<string, Promise<ModelRuntimeBundle>>;
  generation: number;
};

// createAgentSessionServices() rebuilds the whole agent runtime on every call
// (auth.json + models.json parse, settings load, extension/skill/command scan)
// — ~570ms cold. Endpoints the UI polls (e.g. /api/web-settings) must not pay
// that per request, so memoize per cwd with a short TTL and merge concurrent
// loads. Same shape as lib/models-cache.ts; on globalThis to survive hot-reload.
declare global {
  var __piUtilityRuntimeCache: ModelRuntimeCacheState | undefined;
}

const RUNTIME_CACHE_TTL_MS = 30_000;
const MAX_RUNTIME_CACHE_ENTRIES = 8;

function getRuntimeCacheState(): ModelRuntimeCacheState {
  if (!globalThis.__piUtilityRuntimeCache) {
    globalThis.__piUtilityRuntimeCache = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piUtilityRuntimeCache;
}

/** Drop cached runtimes (auth / models.json / settings changed). */
export function invalidateUtilityModelRuntimes(): void {
  const state = getRuntimeCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

async function createModelRuntime(cwd: string): Promise<ModelRuntimeBundle> {
  const agentDir = getAgentDir();
  const modelRuntime = await createConfiguredModelRuntime();
  const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
  return {
    modelRuntime: services.modelRuntime as unknown as ModelRuntimeLike,
    settings: services.settingsManager,
  };
}

function loadModelRuntime(cwd: string): Promise<ModelRuntimeBundle> {
  const state = getRuntimeCacheState();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.bundle);
    state.entries.delete(cwd);
  }

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelRuntimeBundle> = createModelRuntime(cwd)
    .then((bundle) => {
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_RUNTIME_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { bundle, expiresAt: now + RUNTIME_CACHE_TTL_MS });
      }
      return bundle;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}

function applyModelVisibilityFilters<T extends { id: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[] | undefined,
): T[] {
  return filterDisabledModels(
    filterEnabledModels(available, enabledModels),
    getDisabledModelRefs(),
  );
}

export async function listUtilityModels(cwd: string): Promise<UtilityModelOption[]> {
  const { modelRuntime, settings } = await loadModelRuntime(cwd);
  const available = await modelRuntime.getAvailable();
  const visible = applyModelVisibilityFilters(available, settings.getEnabledModels());
  return visible
    .map((m) => ({
      provider: m.provider,
      modelId: m.id,
      name: m.name || m.id,
    }))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (byName !== 0) return byName;
      const byProvider = a.provider.localeCompare(b.provider);
      if (byProvider !== 0) return byProvider;
      return a.modelId.localeCompare(b.modelId);
    });
}

/**
 * Resolve a model for lightweight utility tasks (title / commit message).
 * Preference order: explicit preferred → settings default → first available.
 */
export async function resolveUtilityModel(
  cwd: string,
  preferred?: ModelRef | null,
): Promise<ResolvedUtilityModel> {
  const { modelRuntime, settings } = await loadModelRuntime(cwd);
  const available = await modelRuntime.getAvailable();
  const visible = applyModelVisibilityFilters(available, settings.getEnabledModels());
  if (visible.length === 0) {
    throw new Error("No available model. Configure auth and a default model first.");
  }

  if (preferred) {
    const match = visible.find((m) => m.provider === preferred.provider && m.id === preferred.modelId);
    if (match) {
      return {
        model: match as Model<string>,
        source: "preferred",
        ref: { provider: match.provider, modelId: match.id },
        modelRuntime,
      };
    }
    throw new Error(
      `Configured utility model is unavailable: ${formatModelRef(preferred)}. Pick another model in Settings.`,
    );
  }

  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  const fallback = (provider && modelId
    ? visible.find((m) => m.provider === provider && m.id === modelId)
    : undefined) ?? visible[0];
  if (!fallback) {
    throw new Error("No available model. Configure auth and a default model first.");
  }
  return {
    model: fallback as Model<string>,
    source: provider && modelId && fallback.provider === provider && fallback.id === modelId
      ? "default"
      : "first",
    ref: { provider: fallback.provider, modelId: fallback.id },
    modelRuntime,
  };
}

/**
 * Resolve a preferred model against an already-open session runtime (title gen).
 * Returns null when no preference is set so callers can keep the session model.
 */
export async function resolvePreferredSessionModel(
  modelRuntime: {
    getAvailable: () => Promise<readonly { id: string; provider: string; name?: string }[]>;
    getModel: (provider: string, modelId: string) => unknown;
  },
  settings: {
    getEnabledModels: () => string[] | undefined;
  },
  preferred: ModelRef | null | undefined,
): Promise<Model<string> | null> {
  if (!preferred) return null;
  const available = await modelRuntime.getAvailable();
  const visible = applyModelVisibilityFilters(available, settings.getEnabledModels());
  const match = visible.find((m) => m.provider === preferred.provider && m.id === preferred.modelId);
  if (!match) {
    throw new Error(
      `Configured title model is unavailable: ${formatModelRef(preferred)}. Pick another model in Settings.`,
    );
  }
  return match as Model<string>;
}
