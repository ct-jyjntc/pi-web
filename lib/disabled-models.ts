import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "./agent-dir.ts";

/**
 * Models marked disabled stay configured in runtime catalogs / models.json but
 * are hidden from pickers / utility model resolution on the Pi Web side.
 *
 * Sources (merged):
 * 1. models.json `providers.*.models[].disabled: true` (custom + free providers)
 * 2. ~/.pi/agent/disabled-models.json string[] of "provider/modelId"
 *    (built-in API-key / OAuth providers — cannot put unknown top-level keys in
 *    models.json without failing the SDK schema)
 */

function modelsJsonPath(override?: string): string {
  return override ?? join(getAgentDir(), "models.json");
}

function disabledListPath(override?: string): string {
  return override ?? join(getAgentDir(), "disabled-models.json");
}

function modelRef(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function parseRef(ref: string): { provider: string; modelId: string } | null {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) return null;
  return {
    provider: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

function readModelsJsonDisabled(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      providers?: Record<string, { models?: Array<{ id?: unknown; disabled?: unknown }> }>;
    };
    const refs = new Set<string>();
    for (const [provider, providerConfig] of Object.entries(data.providers ?? {})) {
      for (const model of providerConfig?.models ?? []) {
        if (model?.disabled !== true) continue;
        if (typeof model.id !== "string" || !model.id.trim()) continue;
        refs.add(modelRef(provider, model.id));
      }
    }
    return refs;
  } catch {
    return new Set();
  }
}

function readDisabledListFile(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return new Set();
    const refs = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const parsed = parseRef(entry);
      if (!parsed) continue;
      refs.add(modelRef(parsed.provider, parsed.modelId));
    }
    return refs;
  } catch {
    return new Set();
  }
}

function writeDisabledListFile(path: string, refs: ReadonlySet<string>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sorted = [...refs].sort((a, b) => a.localeCompare(b));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function getDisabledModelRefs(modelsJsonPathOverride?: string, listPath?: string): Set<string> {
  const fromModels = readModelsJsonDisabled(modelsJsonPath(modelsJsonPathOverride));
  const fromList = readDisabledListFile(disabledListPath(listPath));
  if (fromList.size === 0) return fromModels;
  if (fromModels.size === 0) return fromList;
  const merged = new Set(fromModels);
  for (const ref of fromList) merged.add(ref);
  return merged;
}

export function isModelDisabled(
  provider: string,
  modelId: string,
  disabled: ReadonlySet<string>,
): boolean {
  return disabled.has(modelRef(provider, modelId));
}

export function filterDisabledModels<T extends { id: string; provider: string }>(
  available: readonly T[],
  disabled: ReadonlySet<string> = getDisabledModelRefs(),
): T[] {
  if (disabled.size === 0) return [...available];
  return available.filter((m) => !isModelDisabled(m.provider, m.id, disabled));
}

/**
 * Toggle a built-in (API-key / OAuth) model via the dedicated denylist file.
 * Does not touch models.json provider entries (avoids clobbering runtime catalogs).
 */
export function setBuiltinModelDisabled(
  provider: string,
  modelId: string,
  disabled: boolean,
  listPath?: string,
): { ok: true; ref: string; disabled: boolean } | { ok: false; error: string } {
  const p = provider.trim();
  const id = modelId.trim();
  if (!p || !id) return { ok: false, error: "provider and modelId are required" };
  if (p.includes("/") || id.includes("\n")) {
    return { ok: false, error: "invalid provider or modelId" };
  }

  const path = disabledListPath(listPath);
  const refs = readDisabledListFile(path);
  const ref = modelRef(p, id);
  if (disabled) refs.add(ref);
  else refs.delete(ref);
  writeDisabledListFile(path, refs);
  return { ok: true, ref, disabled };
}

/** Read-only snapshot of the dedicated denylist (not models.json flags). */
export function getBuiltinDisabledModelRefs(listPath?: string): Set<string> {
  return readDisabledListFile(disabledListPath(listPath));
}
