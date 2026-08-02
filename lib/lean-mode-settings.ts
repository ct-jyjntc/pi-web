/**
 * Lean Mode types + pure parse/defaults (client-safe; no fs/path).
 */
import { isRecord } from "./type-guards";

export type LeanIntensity = "soft" | "review" | "hard";

export type LeanHardGates = {
  /** Files at or above this line count are "large" (default 800). */
  largeFileLineThreshold: number;
  /** Max net line growth per edit on a large file when intensity is hard (default 30). */
  maxNetGrowthOnLargeFile: number;
};

export type LeanModeSettings = {
  /** Master switch; default false — zero behavior change when off. */
  enabled: boolean;
  /** soft = policy only; review/hard = policy + post-edit lean review. */
  intensity: LeanIntensity;
  /** When intensity is review|hard, run lean review after edit turns. */
  reviewOnAgentEnd: boolean;
  /** Mechanical gates (applied only when intensity is hard). */
  hardGates: LeanHardGates;
};

const LEAN_INTENSITIES = new Set<LeanIntensity>(["soft", "review", "hard"]);

export function defaultHardGates(): LeanHardGates {
  return {
    largeFileLineThreshold: 800,
    maxNetGrowthOnLargeFile: 30,
  };
}

export function defaultLeanModeSettings(): LeanModeSettings {
  return {
    enabled: false,
    intensity: "review",
    reviewOnAgentEnd: true,
    hardGates: defaultHardGates(),
  };
}

export function parseLeanModeSettings(value: unknown): LeanModeSettings {
  const base = defaultLeanModeSettings();
  if (!isRecord(value)) return base;
  const intensityRaw = typeof value.intensity === "string" ? value.intensity : "";
  const hardRaw = isRecord(value.hardGates) ? value.hardGates : {};
  const thr = Number(hardRaw.largeFileLineThreshold);
  const maxNet = Number(hardRaw.maxNetGrowthOnLargeFile);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : base.enabled,
    intensity: LEAN_INTENSITIES.has(intensityRaw as LeanIntensity)
      ? (intensityRaw as LeanIntensity)
      : base.intensity,
    reviewOnAgentEnd:
      typeof value.reviewOnAgentEnd === "boolean" ? value.reviewOnAgentEnd : base.reviewOnAgentEnd,
    hardGates: {
      largeFileLineThreshold:
        Number.isFinite(thr) && thr >= 100 ? Math.min(50_000, Math.floor(thr)) : base.hardGates.largeFileLineThreshold,
      maxNetGrowthOnLargeFile:
        Number.isFinite(maxNet) && maxNet >= 0
          ? Math.min(5000, Math.floor(maxNet))
          : base.hardGates.maxNetGrowthOnLargeFile,
    },
  };
}
