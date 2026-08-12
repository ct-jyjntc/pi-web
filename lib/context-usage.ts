import { readFileSync } from "fs";
import { join } from "path";
import { estimateTokens, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ContextUsage } from "@/lib/pi-types";
import { resolveCachedModelContextWindow } from "./builtin-provider-models-cache";
import { getModelOverride } from "./model-overrides";

export type ContextUsageSnapshot = ContextUsage;

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Sum heuristic token estimates for a message list (same basis as compact's estimatedTokensAfter). */
export function estimateTokensFromMessages(messages: readonly unknown[]): number {
  let tokens = 0;
  for (const message of messages) {
    try {
      const n = estimateTokens(message as never);
      if (typeof n === "number" && Number.isFinite(n) && n > 0) tokens += n;
      else tokens += fallbackEstimateMessage(message);
    } catch {
      tokens += fallbackEstimateMessage(message);
    }
  }
  return tokens;
}

/** Best-effort chars/4 when estimateTokens rejects a UI message shape. */
function fallbackEstimateMessage(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const m = message as Record<string, unknown>;
  try {
    const raw = typeof m.content === "string"
      ? m.content
      : JSON.stringify(m.content ?? m.summary ?? m.command ?? m.output ?? "");
    return Math.ceil(raw.length / 4);
  } catch {
    return 0;
  }
}

export function buildContextUsageSnapshot(
  tokens: number,
  contextWindow: number,
): ContextUsageSnapshot | null {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  if (!Number.isFinite(tokens) || tokens < 0) {
    return { tokens: null, contextWindow, percent: null };
  }
  return {
    tokens,
    contextWindow,
    percent: (tokens / contextWindow) * 100,
  };
}

/** Fast path: read contextWindow from ~/.pi/agent/models.json (no AgentSession). */
export function resolveContextWindowFromModelsJson(
  model: { provider: string; modelId: string } | null | undefined,
): number | null {
  if (!model?.provider || !model.modelId) return null;
  try {
    const path = join(getAgentDir(), "models.json");
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      providers?: Record<string, { models?: Array<{ id?: string; contextWindow?: number }> }>;
    };
    const providers = data.providers ?? {};
    const providerEntry = providers[model.provider]
      ?? Object.entries(providers).find(([key]) => key.toLowerCase() === model.provider.toLowerCase())?.[1];
    if (!providerEntry?.models?.length) return null;
    const found = providerEntry.models.find((entry) =>
      entry.id === model.modelId
      || (typeof entry.id === "string" && entry.id.toLowerCase() === model.modelId.toLowerCase())
    );
    return asPositiveInt(found?.contextWindow);
  } catch {
    return null;
  }
}

/** Fast path: SDK models-store.json written by ModelRuntime / GET /api/models. */
export function resolveContextWindowFromModelsStore(
  model: { provider: string; modelId: string } | null | undefined,
): number | null {
  if (!model?.provider || !model.modelId) return null;
  try {
    const path = join(getAgentDir(), "models-store.json");
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, {
      models?: Array<{ id?: string; contextWindow?: number }>;
    }>;
    const entry = data[model.provider]
      ?? Object.entries(data).find(([key]) => key.toLowerCase() === model.provider.toLowerCase())?.[1];
    if (!entry?.models?.length) return null;
    const found = entry.models.find((row) =>
      row.id === model.modelId
      || (typeof row.id === "string" && row.id.toLowerCase() === model.modelId.toLowerCase())
    );
    return asPositiveInt(found?.contextWindow);
  } catch {
    return null;
  }
}

/** Resolve a model's context window from on-disk catalogs — never start an AgentSession. */
export async function resolveModelContextWindow(
  cwd: string,
  model: { provider: string; modelId: string } | null | undefined,
): Promise<number | null> {
  if (!model?.provider || !model.modelId) return null;

  // Prefer models.json — custom providers and does not spin up runtime.
  const fromFile = resolveContextWindowFromModelsJson(model);
  if (fromFile) return fromFile;

  // Built-in / OAuth catalogs live in our Settings cache and the SDK models-store,
  // not in models.json. Cold open must read those files or the ring stays empty
  // until the next live AgentSession (i.e. the user sends a message).
  const fromCache = resolveCachedModelContextWindow(model.provider, model.modelId);
  if (fromCache) return fromCache;

  const fromStore = resolveContextWindowFromModelsStore(model);
  if (fromStore) return fromStore;

  const fromOverride = asPositiveInt(getModelOverride(model.provider, model.modelId)?.contextWindow);
  if (fromOverride) return fromOverride;

  // Intentionally do NOT fall back to createConfiguredModelRuntime /
  // createAgentSessionServices. Session GET runs this on every cold open;
  // spinning the agent services just to read a context window blocked the
  // heavy IPC queue and made "Loading session..." last many seconds.
  // Live AgentSession state overwrites contextUsage once the session is running.
  void cwd;
  return null;
}

/**
 * After compaction the SDK returns null usage until the next assistant reply.
 * When that happens, estimate from the live message list for UI display.
 */
export function resolveContextUsageForUi(
  raw: { percent?: number | null; contextWindow: number; tokens?: number | null } | null | undefined,
  messages: readonly unknown[] | null | undefined,
): ContextUsageSnapshot | null {
  if (!raw) return null;
  if (raw.percent != null && raw.tokens != null) {
    return {
      percent: raw.percent,
      contextWindow: raw.contextWindow,
      tokens: raw.tokens,
    };
  }
  const contextWindow = raw.contextWindow;
  if (!contextWindow || contextWindow <= 0) {
    return { percent: null, contextWindow, tokens: null };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { percent: null, contextWindow, tokens: null };
  }
  try {
    return buildContextUsageSnapshot(estimateTokensFromMessages(messages), contextWindow);
  } catch {
    return {
      percent: raw.percent ?? null,
      contextWindow,
      tokens: raw.tokens ?? null,
    };
  }
}

/** Build UI context usage for a session file branch (cold open / leaf switch). */
export async function estimateSessionContextUsage(options: {
  cwd: string;
  model: { provider: string; modelId: string } | null | undefined;
  messages: readonly unknown[];
}): Promise<ContextUsageSnapshot | null> {
  const contextWindow = await resolveModelContextWindow(options.cwd, options.model);
  if (!contextWindow) return null;
  return buildContextUsageSnapshot(
    estimateTokensFromMessages(options.messages),
    contextWindow,
  );
}
