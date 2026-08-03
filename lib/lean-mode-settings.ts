/**
 * Lean Mode types + pure parse/defaults (client-safe; no fs/path).
 */
import { isRecord } from "./type-guards";

export type LeanIntensity = "soft" | "review" | "hard";

export type LeanModeSettings = {
  /** Master switch; default false — zero behavior change when off. */
  enabled: boolean;
  /** soft = advisory wording; review = default; hard = MUST wording. */
  intensity: LeanIntensity;
};

const LEAN_INTENSITIES = new Set<LeanIntensity>(["soft", "review", "hard"]);

export function defaultLeanModeSettings(): LeanModeSettings {
  return {
    enabled: false,
    intensity: "review",
  };
}

export function parseLeanModeSettings(value: unknown): LeanModeSettings {
  const base = defaultLeanModeSettings();
  if (!isRecord(value)) return base;
  const intensityRaw = typeof value.intensity === "string" ? value.intensity : "";
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : base.enabled,
    intensity: LEAN_INTENSITIES.has(intensityRaw as LeanIntensity)
      ? (intensityRaw as LeanIntensity)
      : base.intensity,
  };
}