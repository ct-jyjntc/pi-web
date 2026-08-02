/**
 * Per-model field overrides for built-in (API-key / OAuth) catalogs.
 * Stored under ~/.pi/agent/model-overrides.json as "provider/modelId" → fields.
 * Used when official catalog does not supply thinkingLevelMap / etc.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevelMap } from "./thinking-level-map";

export type ModelOverrideFields = {
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
};

function overridesPath(override?: string): string {
  return override ?? join(getAgentDir(), "model-overrides.json");
}

function modelRef(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function readAll(path: string): Record<string, ModelOverrideFields> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as Record<string, ModelOverrideFields>;
  } catch {
    return {};
  }
}

function writeAll(path: string, data: Record<string, ModelOverrideFields>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0x1c0 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function getModelOverride(
  provider: string,
  modelId: string,
  path?: string,
): ModelOverrideFields | undefined {
  const all = readAll(overridesPath(path));
  const entry = all[modelRef(provider, modelId)];
  return entry && typeof entry === "object" ? entry : undefined;
}

export function setModelOverride(
  provider: string,
  modelId: string,
  patch: ModelOverrideFields,
  path?: string,
): ModelOverrideFields {
  const file = overridesPath(path);
  const all = readAll(file);
  const key = modelRef(provider, modelId);
  const next: ModelOverrideFields = { ...(all[key] ?? {}), ...patch };
  // Drop empty thinking maps
  if (next.thinkingLevelMap && Object.keys(next.thinkingLevelMap).length === 0) {
    delete next.thinkingLevelMap;
  }
  if (Object.keys(next).length === 0) delete all[key];
  else all[key] = next;
  writeAll(file, all);
  return next;
}

/** Merge overrides into a thinkingLevelMaps bag keyed as "provider:modelId". */
export function applyThinkingMapOverrides(
  maps: Record<string, Record<string, string | null>>,
  path?: string,
): Record<string, Record<string, string | null>> {
  const all = readAll(overridesPath(path));
  const out = { ...maps };
  for (const [ref, fields] of Object.entries(all)) {
    if (!fields?.thinkingLevelMap) continue;
    const slash = ref.indexOf("/");
    if (slash <= 0) continue;
    const key = `${ref.slice(0, slash)}:${ref.slice(slash + 1)}`;
    out[key] = { ...fields.thinkingLevelMap };
  }
  return out;
}
