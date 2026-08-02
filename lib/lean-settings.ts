/**
 * Resolve effective Lean Mode config: global pi-web.json ⊕ optional project override.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { isRecord } from "./type-guards";
import {
  defaultLeanModeSettings,
  parseLeanModeSettings,
  readWebSettings,
  type LeanModeSettings,
  type WebSettings,
} from "./web-settings";

/** Project-level override file (partial leanMode only is read). */
export const PROJECT_LEAN_FILE = ".pi-web.json";

/**
 * Read `<cwd>/.pi-web.json` → partial leanMode fields, or null if missing/invalid.
 * Never throws.
 */
export function readProjectLeanOverride(cwd: string): Partial<LeanModeSettings> | null {
  const path = join(cwd, PROJECT_LEAN_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(raw) || !isRecord(raw.leanMode)) return null;
    const lm = raw.leanMode;
    const out: Partial<LeanModeSettings> = {};
    if (typeof lm.enabled === "boolean") out.enabled = lm.enabled;
    if (lm.intensity === "soft" || lm.intensity === "review" || lm.intensity === "hard") {
      out.intensity = lm.intensity;
    }
    if (typeof lm.reviewOnAgentEnd === "boolean") out.reviewOnAgentEnd = lm.reviewOnAgentEnd;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Effective lean settings for a cwd. Project fields overlay global when present.
 */
export function resolveLeanMode(
  cwd: string | null | undefined,
  global?: WebSettings,
): LeanModeSettings {
  const base = { ...(global?.leanMode ?? readWebSettings().leanMode ?? defaultLeanModeSettings()) };
  if (!cwd) return base;
  const override = readProjectLeanOverride(cwd);
  if (!override) return base;
  return parseLeanModeSettings({ ...base, ...override });
}
