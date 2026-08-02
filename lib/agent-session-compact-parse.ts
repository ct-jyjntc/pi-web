/**
 * Parse compact command / SSE results into UI toast + context-usage shapes.
 */

import type { ContextUsage } from "@/lib/pi-types";

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

/** Shape returned by the compact agent command / compaction_end payload. */
export interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  contextUsage?: ContextUsage | null;
}

export function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}

export function readCompactContextUsage(
  result: unknown,
  fallbackWindow?: number | null,
): ContextUsage | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (r.contextUsage && typeof r.contextUsage.contextWindow === "number" && r.contextUsage.contextWindow > 0) {
    return {
      percent: r.contextUsage.percent ?? null,
      contextWindow: r.contextUsage.contextWindow,
      tokens: r.contextUsage.tokens ?? null,
    };
  }
  if (typeof r.estimatedTokensAfter !== "number") return null;
  const contextWindow = fallbackWindow && fallbackWindow > 0 ? fallbackWindow : null;
  if (!contextWindow) return null;
  return {
    tokens: r.estimatedTokensAfter,
    contextWindow,
    percent: (r.estimatedTokensAfter / contextWindow) * 100,
  };
}
