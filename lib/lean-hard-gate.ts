/**
 * Lean Mode hard intensity mechanical gate for edit growth on large files.
 * Single owner for reject rules used by the edit tool wrapper.
 */
import { readFileSync, existsSync } from "fs";
import { isAbsolute, resolve } from "path";
import { resolveLeanMode } from "./lean-settings";
import type { LeanModeSettings } from "./lean-mode-settings";

export const DEFAULT_LARGE_FILE_LINES = 800;
export const DEFAULT_MAX_NET_GROWTH = 30;

export type LeanHardGateConfig = {
  largeFileLineThreshold: number;
  maxNetGrowthOnLargeFile: number;
};

export function hardGateConfig(lean: LeanModeSettings): LeanHardGateConfig | null {
  if (!lean.enabled || lean.intensity !== "hard") return null;
  return {
    largeFileLineThreshold: lean.hardGates?.largeFileLineThreshold ?? DEFAULT_LARGE_FILE_LINES,
    maxNetGrowthOnLargeFile: lean.hardGates?.maxNetGrowthOnLargeFile ?? DEFAULT_MAX_NET_GROWTH,
  };
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

/**
 * Estimate net line growth from a hashline-ish patch body (rough +/− line count).
 */
export function estimateHashlineNetGrowth(input: string): number {
  let plus = 0;
  let minus = 0;
  for (const line of input.split(/\r\n|\r|\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) plus += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) minus += 1;
    // SWAP body rows are "+TEXT" after ops; DEL removes lines via N.=M ranges — approximate only.
  }
  // Also count body rows that use "+content" hashline form without being unified diff
  if (plus === 0 && minus === 0) {
    for (const line of input.split(/\r\n|\r|\n/)) {
      if (/^\+[^+]/.test(line) || line.startsWith("+")) plus += 1;
    }
  }
  return plus - minus;
}

export function checkLargeFileNetGrowth(opts: {
  cwd: string;
  path: string;
  netGrowth: number;
  gate: LeanHardGateConfig;
}): string | null {
  const abs = isAbsolute(opts.path) ? opts.path : resolve(opts.cwd, opts.path);
  if (!existsSync(abs)) return null;
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const lines = countLines(text);
  if (lines < opts.gate.largeFileLineThreshold) return null;
  if (opts.netGrowth <= opts.gate.maxNetGrowthOnLargeFile) return null;
  return [
    `Lean Mode hard gate: refusing to grow a large file by ${opts.netGrowth} net lines.`,
    `File: ${abs} (${lines} lines ≥ ${opts.gate.largeFileLineThreshold}).`,
    `Max net growth allowed: ${opts.gate.maxNetGrowthOnLargeFile}.`,
    "Extract a module first, or lower intensity, or raise hardGates in settings.",
  ].join("\n");
}

/** Resolve gate for cwd or null when not hard. */
export function resolveHardGateForCwd(cwd: string): LeanHardGateConfig | null {
  return hardGateConfig(resolveLeanMode(cwd));
}
