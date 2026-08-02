/**
 * Read/write project-level Lean Mode override in <cwd>/.pi-web.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { isRecord } from "./type-guards";
import {
  parseLeanModeSettings,
  type LeanModeSettings,
} from "./lean-mode-settings";
import { PROJECT_LEAN_FILE, readProjectLeanOverride } from "./lean-settings";

export function projectLeanFilePath(cwd: string): string {
  return join(cwd, PROJECT_LEAN_FILE);
}

export function readProjectLeanFile(cwd: string): {
  path: string;
  override: Partial<LeanModeSettings> | null;
  raw: Record<string, unknown>;
} {
  const path = projectLeanFilePath(cwd);
  if (!existsSync(path)) {
    return { path, override: null, raw: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const raw = isRecord(parsed) ? { ...parsed } : {};
    return { path, override: readProjectLeanOverride(cwd), raw };
  } catch {
    return { path, override: null, raw: {} };
  }
}

/** Merge partial leanMode into project file; preserves other keys. */
export function writeProjectLeanOverride(
  cwd: string,
  partial: Partial<LeanModeSettings> | null,
): { path: string; leanMode: Partial<LeanModeSettings> | null } {
  const path = projectLeanFilePath(cwd);
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (isRecord(parsed)) raw = parsed;
    } catch {
      raw = {};
    }
  }

  if (partial === null) {
    delete raw.leanMode;
  } else {
    const prev = isRecord(raw.leanMode) ? raw.leanMode : {};
    const merged = parseLeanModeSettings({ ...prev, ...partial });
    // Store only fields that were explicitly provided + required structure
    const stored: Record<string, unknown> = { ...prev };
    if ("enabled" in partial) stored.enabled = partial.enabled;
    if ("intensity" in partial) stored.intensity = partial.intensity;
    if ("reviewOnAgentEnd" in partial) stored.reviewOnAgentEnd = partial.reviewOnAgentEnd;
    if ("hardGates" in partial && partial.hardGates) stored.hardGates = partial.hardGates;
    // Ensure valid shape when writing full enable
    if (Object.keys(stored).length === 0) {
      raw.leanMode = {
        enabled: merged.enabled,
        intensity: merged.intensity,
        reviewOnAgentEnd: merged.reviewOnAgentEnd,
      };
    } else {
      raw.leanMode = stored;
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return {
    path,
    leanMode: partial === null ? null : (raw.leanMode as Partial<LeanModeSettings>),
  };
}
