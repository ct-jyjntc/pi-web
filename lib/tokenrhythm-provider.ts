/**
 * Pi Web–managed native provider for 基元律动 (Token Rhythm).
 * Behaves like built-in API-key providers (Groq/OpenRouter): AuthStorage key,
 * static catalog + optional network refresh, fixed base URL.
 *
 * Server-only — do not import from client components. Use tokenrhythm-constants.ts
 * for UI ids / icon URLs.
 */

import {
  createProvider,
  envApiKeyAuth,
  type Model,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

// Keep constants inlined so this server module has no local relative imports
// (node --test resolves extensionless paths poorly under moduleResolution bundler).
// Client UI must import from tokenrhythm-constants.ts instead.
const TOKENRHYTHM_PROVIDER_ID = "tokenrhythm";
const TOKENRHYTHM_DISPLAY_NAME = "基元律动";
const TOKENRHYTHM_BASE_URL = "https://tokenrhythm.studio/v1";
const TOKENRHYTHM_CATALOG_URL = "https://tokenrhythm.studio/api/models";

export {
  TOKENRHYTHM_PROVIDER_ID,
  TOKENRHYTHM_DISPLAY_NAME,
  TOKENRHYTHM_BASE_URL,
  TOKENRHYTHM_CATALOG_URL,
};

const TOKENRHYTHM_STATIC_MODELS: Model<"openai-completions">[] = [
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 1,
      "output": 2,
      "cacheRead": 0.2,
      "cacheWrite": 0
    },
    "contextWindow": 1000000,
    "maxTokens": 384000
  },
  {
    "id": "deepseek-v4-flash-0731",
    "name": "DeepSeek V4 Flash 0731",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 1,
      "output": 2,
      "cacheRead": 0.2,
      "cacheWrite": 0
    },
    "contextWindow": 1000000,
    "maxTokens": 384000
  },
  {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 3,
      "output": 6,
      "cacheRead": 0.025,
      "cacheWrite": 0
    },
    "contextWindow": 1000000,
    "maxTokens": 384000
  },
  {
    "id": "glm-5",
    "name": "GLM-5",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 6,
      "output": 22,
      "cacheRead": 1.5,
      "cacheWrite": 0
    },
    "contextWindow": 1000000,
    "maxTokens": 128000
  },
  {
    "id": "glm-5.1",
    "name": "GLM-5.1",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 8,
      "output": 28,
      "cacheRead": 2,
      "cacheWrite": 0
    },
    "contextWindow": 200000,
    "maxTokens": 128000
  },
  {
    "id": "minimax-m2.7",
    "name": "MiniMax M2.7",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 2.1,
      "output": 8.4,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 200000,
    "maxTokens": 192000
  },
  {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 4,
      "output": 21,
      "cacheRead": 0.8,
      "cacheWrite": 0
    },
    "contextWindow": 256000,
    "maxTokens": 64000
  },
  {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 6.5,
      "output": 27,
      "cacheRead": 1.3,
      "cacheWrite": 0
    },
    "contextWindow": 256000,
    "maxTokens": 128000
  },
  {
    "id": "minimax-m2.5",
    "name": "MiniMax M2.5",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 2.1,
      "output": 8.4,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 200000,
    "maxTokens": 200000
  },
  {
    "id": "mimo-v2.5-pro",
    "name": "Mimo V2.5 Pro",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 3,
      "output": 6,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 256000,
    "maxTokens": 256000
  },
  {
    "id": "qwen3.7-max",
    "name": "Qwen3.7 Max",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 6,
      "output": 18,
      "cacheRead": 1.2,
      "cacheWrite": 0
    },
    "contextWindow": 1000000,
    "maxTokens": 131072
  },
  {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 6.5,
      "output": 27,
      "cacheRead": 1.3,
      "cacheWrite": 0
    },
    "contextWindow": 256000,
    "maxTokens": 128000
  },
  {
    "id": "glm-5.2",
    "name": "GLM-5.2",
    "api": "openai-completions",
    "provider": "tokenrhythm",
    "baseUrl": "https://tokenrhythm.studio/v1",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 8,
      "output": 28,
      "cacheRead": 2,
      "cacheWrite": 0
    },
    "contextWindow": 1000000,
    "maxTokens": 128000
  }
] as Model<"openai-completions">[];

type TokenRhythmCatalogEntry = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  contextWindow?: unknown;
  maxOutputTokens?: unknown;
  supportsVision?: unknown;
  supportsReasoning?: unknown;
  modalities?: unknown;
  capabilities?: { vision?: unknown };
  effectiveInputPrice?: unknown;
  effectiveOutputPrice?: unknown;
  effectiveCacheReadPrice?: unknown;
  inputPrice?: unknown;
  outputPrice?: unknown;
  cacheReadPrice?: unknown;
};

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toModel(entry: TokenRhythmCatalogEntry): Model<"openai-completions"> | null {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const input: Array<"text" | "image"> = ["text"];
  const modalities = Array.isArray(entry.modalities) ? entry.modalities : [];
  if (
    entry.supportsVision === true
    || entry.capabilities?.vision === true
    || modalities.includes("image")
  ) {
    input.push("image");
  }
  const contextWindow = num(entry.contextWindow, 128_000) || 128_000;
  const maxTokens = num(entry.maxOutputTokens, 8_192) || 8_192;
  return {
    id,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
    api: "openai-completions",
    provider: TOKENRHYTHM_PROVIDER_ID,
    baseUrl: TOKENRHYTHM_BASE_URL,
    reasoning: entry.supportsReasoning === true,
    input,
    cost: {
      input: num(entry.effectiveInputPrice ?? entry.inputPrice),
      output: num(entry.effectiveOutputPrice ?? entry.outputPrice),
      cacheRead: num(entry.effectiveCacheReadPrice ?? entry.cacheReadPrice),
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
  };
}

function staticModels(): Model<"openai-completions">[] {
  return TOKENRHYTHM_STATIC_MODELS.map((model) => ({
    ...model,
    provider: TOKENRHYTHM_PROVIDER_ID,
    baseUrl: TOKENRHYTHM_BASE_URL,
    api: "openai-completions" as const,
  }));
}

async function fetchTokenRhythmModels(
  context: RefreshModelsContext,
): Promise<readonly Model<"openai-completions">[]> {
  if (!context.allowNetwork) {
    const stored = await context.store.read();
    if (stored?.models?.length) {
      return stored.models.filter(
        (m): m is Model<"openai-completions"> =>
          m.provider === TOKENRHYTHM_PROVIDER_ID && m.api === "openai-completions",
      );
    }
    return staticModels();
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  context.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(TOKENRHYTHM_CATALOG_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: TokenRhythmCatalogEntry[] };
    const raw = Array.isArray(json?.data) ? json.data : [];
    const models = raw
      .filter((entry) => entry?.type === "chat")
      .map(toModel)
      .filter((m): m is Model<"openai-completions"> => !!m);
    if (models.length === 0) throw new Error("Empty catalog");
    if (!context.signal?.aborted) {
      await context.store.write({ models, checkedAt: Date.now() });
    }
    return models;
  } catch {
    const stored = await context.store.read();
    if (stored?.models?.length) {
      return stored.models.filter(
        (m): m is Model<"openai-completions"> =>
          m.provider === TOKENRHYTHM_PROVIDER_ID && m.api === "openai-completions",
      );
    }
    return staticModels();
  } finally {
    clearTimeout(timeout);
    context.signal?.removeEventListener("abort", onAbort);
  }
}

export function createTokenRhythmProvider(): Provider<"openai-completions"> {
  return createProvider({
    id: TOKENRHYTHM_PROVIDER_ID,
    name: TOKENRHYTHM_DISPLAY_NAME,
    baseUrl: TOKENRHYTHM_BASE_URL,
    auth: {
      apiKey: envApiKeyAuth("基元律动 API key", ["TOKENRHYTHM_API_KEY"]),
    },
    models: staticModels(),
    fetchModels: fetchTokenRhythmModels,
    api: openAICompletionsApi(),
  });
}
