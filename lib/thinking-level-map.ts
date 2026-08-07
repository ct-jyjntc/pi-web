/**
 * Map vendor reasoning/effort options onto Pi thinkingLevelMap.
 * Single owner for effort/toggle → off/minimal/low/…/max mapping.
 */

import { isRecord } from "./type-guards";

/** Pi UI thinking levels (keep in sync with models-config THINKING_LEVELS). */
export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export type ThinkingLevelMap = Record<string, string | null>;

/**
 * Levels shown in the chat thinking picker.
 * - No map → SDK fallback only.
 * - Map present → use it exclusively (never merge with SDK list):
 *   only keys with a non-null value are offered.
 *   (`null` = disabled; omitted key = not part of user budget.)
 */
export function availableThinkingLevelsFromMap(
  map: ThinkingLevelMap | Record<string, string | null> | null | undefined,
  fallback: readonly string[],
): string[] {
  if (!map || Object.keys(map).length === 0) return [...fallback];
  return PI_THINKING_LEVELS.filter((level) => {
    if (!(level in map)) return false;
    return map[level] !== null;
  });
}
/**
 * Build a Pi thinkingLevelMap from vendor `reasoning_options`.
 * - effort.values → discrete level map (unsupported UI levels disabled with null)
 * - toggle / budget_tokens only → undefined (runtime defaults)
 */
export function thinkingLevelMapFromReasoningOptions(
  options: unknown,
): ThinkingLevelMap | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;

  let effortValues: string[] | undefined;
  for (const opt of options) {
    if (!isRecord(opt)) continue;
    if (opt.type !== "effort" || !Array.isArray(opt.values)) continue;
    const values = opt.values
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    if (values.length > 0) {
      effortValues = values;
      break;
    }
  }

  if (!effortValues?.length) return undefined;
  return mapEffortValuesToThinkingLevelMap(effortValues);
}

export function mapEffortValuesToThinkingLevelMap(
  values: readonly string[],
): ThinkingLevelMap {
  const byLower = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (!byLower.has(key)) byLower.set(key, trimmed);
  }

  const has = (name: string) => byLower.has(name);
  const get = (name: string) => byLower.get(name)!;

  const map: ThinkingLevelMap = {};

  if (has("none")) map.off = get("none");
  else if (has("off")) map.off = get("off");
  else map.off = null;

  for (const level of ["minimal", "low", "medium", "high", "max"] as const) {
    map[level] = has(level) ? get(level) : null;
  }

  // xhigh: exact match, else max (common for deepseek-style high/max pairs)
  if (has("xhigh")) map.xhigh = get("xhigh");
  else if (has("max")) map.xhigh = get("max");
  else map.xhigh = null;

  const namedEnabled = (["minimal", "low", "medium", "high", "xhigh", "max"] as const)
    .some((level) => map[level] !== null);

  // Official effort labels that don't match Pi names (positional fallback).
  if (!namedEnabled) {
    const efforts = values
      .map((value) => value.trim())
      .filter((value) => {
        const lower = value.toLocaleLowerCase();
        return lower && lower !== "none" && lower !== "off";
      });
    for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
      map[level] = null;
    }
    const targets = (["minimal", "low", "medium", "high", "xhigh", "max"] as const)
      .slice(-efforts.length);
    efforts.forEach((value, index) => {
      map[targets[index]] = value;
    });
  }

  return map;
}

export function sameThinkingLevelMap(
  a: ThinkingLevelMap | undefined,
  b: ThinkingLevelMap | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
