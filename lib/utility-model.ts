import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
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

async function loadModelRuntime(cwd: string): Promise<{
  modelRuntime: ModelRuntimeLike;
  settings: SettingsManager;
}> {
  const agentDir = getAgentDir();
  const services = await createAgentSessionServices({ cwd, agentDir });
  return {
    modelRuntime: services.modelRuntime as unknown as ModelRuntimeLike,
    settings: services.settingsManager,
  };
}

export async function listUtilityModels(cwd: string): Promise<UtilityModelOption[]> {
  const { modelRuntime, settings } = await loadModelRuntime(cwd);
  const available = await modelRuntime.getAvailable();
  const visible = filterEnabledModels(available, settings.getEnabledModels());
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
  const visible = filterEnabledModels(available, settings.getEnabledModels());
  if (visible.length === 0) {
    throw new Error("No available model. Configure auth and a default model first.");
  }

  if (preferred) {
    const match = visible.find((m) => m.provider === preferred.provider && m.id === preferred.modelId)
      ?? modelRuntime.getModel(preferred.provider, preferred.modelId);
    if (match && visible.some((m) => m.provider === match.provider && m.id === match.id)) {
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
  const visible = filterEnabledModels(available, settings.getEnabledModels());
  const match = visible.find((m) => m.provider === preferred.provider && m.id === preferred.modelId)
    ?? modelRuntime.getModel(preferred.provider, preferred.modelId);
  if (!match) {
    throw new Error(
      `Configured title model is unavailable: ${formatModelRef(preferred)}. Pick another model in Settings.`,
    );
  }
  return match as Model<string>;
}
