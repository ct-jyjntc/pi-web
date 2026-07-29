import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Models marked `disabled: true` in ~/.pi/agent/models.json stay configured
 * but are hidden from pickers / utility model resolution.
 * The pi SDK ignores unknown model fields and still loads them into runtime —
 * filtering happens here on the Pi Web side.
 */
export function getDisabledModelRefs(modelsJsonPath?: string): Set<string> {
  const path = modelsJsonPath ?? join(getAgentDir(), "models.json");
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
        // Keep id exactly as stored so it matches runtime model ids.
        refs.add(`${provider}/${model.id}`);
      }
    }
    return refs;
  } catch {
    return new Set();
  }
}

export function isModelDisabled(
  provider: string,
  modelId: string,
  disabled: ReadonlySet<string>,
): boolean {
  return disabled.has(`${provider}/${modelId}`);
}

export function filterDisabledModels<T extends { id: string; provider: string }>(
  available: readonly T[],
  disabled: ReadonlySet<string> = getDisabledModelRefs(),
): T[] {
  if (disabled.size === 0) return [...available];
  return available.filter((m) => !isModelDisabled(m.provider, m.id, disabled));
}
