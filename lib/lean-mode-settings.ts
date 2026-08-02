/**
 * Lean Mode types + pure parse/defaults (client-safe; no fs/path).
 */
import { isRecord } from "./type-guards";

export type LeanIntensity = "soft" | "review" | "hard";

export type LeanModeSettings = {
  /** Master switch; default false — zero behavior change when off. */
  enabled: boolean;
  /** soft = policy only; review/hard = policy + post-edit lean review. */
  intensity: LeanIntensity;
  /** When intensity is review|hard, run lean review after edit turns. */
  reviewOnAgentEnd: boolean;
};

const LEAN_INTENSITIES = new Set<LeanIntensity>(["soft", "review", "hard"]);

export function defaultLeanModeSettings(): LeanModeSettings {
  return {
    enabled: false,
    intensity: "review",
    reviewOnAgentEnd: true,
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
    reviewOnAgentEnd:
      typeof value.reviewOnAgentEnd === "boolean" ? value.reviewOnAgentEnd : base.reviewOnAgentEnd,
  };
}
