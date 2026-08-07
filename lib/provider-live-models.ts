/**
 * Subscription-native live model lists.
 *
 * Single owner for wrapping OAuth/subscription builtins so refreshModels hits
 * each vendor's own catalog — never pi.dev.
 *
 * Fallback (one path): live API → models-store → static baseline.
 *
 * Sources:
 * - Kimi / xAI / OpenRouter: OpenAI-compatible GET {base}/models
 * - Codex: GET https://chatgpt.com/backend-api/codex/models (openai/codex CLI)
 * - Copilot: GET {copilot-api}/models (same as pi-ai oauth)
 * - Anthropic: GET https://api.anthropic.com/v1/models (platform; works with OAuth access-as-key)
 */
import type {
  Api,
  Credential,
  Model,
  Provider,
  ProviderHeaders,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import {
  clearSoftCatalogMeta,
  codexModelsFromApi,
  openAIModelsFromRichCatalog,
  type OpenAIModelsRawRow,
} from "./subscription-oauth-shared";

type AnyModel = Model<Api>;

/** Per-request budget so one slow vendor cannot pin the heavy runtime. */
export const PROVIDER_LIVE_MODELS_TIMEOUT_MS = 10_000;

/**
 * Subscription providers with a known first-party models list after login.
 * Stock API-key clouds are not adapted — use Custom (models.json).
 */
export const SUBSCRIPTION_LIVE_MODEL_PROVIDERS = new Set([
  "kimi-coding",
  "xai",
  "openrouter",
  "openai-codex",
  "github-copilot",
  "anthropic",
  // First-party (own fetchModels on the provider; listed so materialize can live-fetch)
  "nous",
  "minimax-oauth",
]);

/** @deprecated use SUBSCRIPTION_LIVE_MODEL_PROVIDERS */
export const OPENAI_COMPAT_LIVE_MODEL_PROVIDERS = SUBSCRIPTION_LIVE_MODEL_PROVIDERS;

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

const COPILOT_HEADERS: Record<string, string> = {
  "Editor-Version": "pi-web/1.0",
  "Editor-Plugin-Version": "pi-web/1.0",
  "Copilot-Integration-Id": "vscode-chat",
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "X-GitHub-Api-Version": "2025-04-01",
};

function mergeModels(baseline: readonly AnyModel[], dynamic: readonly AnyModel[]): AnyModel[] {
  const merged = [...baseline];
  for (const model of dynamic) {
    const index = merged.findIndex((entry) => entry.id === model.id);
    if (index >= 0) merged[index] = model;
    else merged.push(model);
  }
  return merged;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Map live ids onto full Model rows, preferring static metadata when ids match. */
export function projectLiveModelIds(
  providerId: string,
  ids: readonly string[],
  baseline: readonly AnyModel[],
): AnyModel[] {
  if (ids.length === 0) return [];
  const byId = new Map(baseline.map((m) => [m.id, m]));
  const template = baseline[0];
  const out: AnyModel[] = [];
  for (const id of ids) {
    const known = byId.get(id);
    if (known) {
      out.push(known);
      continue;
    }
    if (!template) continue;
    out.push({
      ...template,
      id,
      name: id,
      provider: providerId,
    });
  }
  return out;
}

function parseOpenAIStyleIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { models?: unknown }).models)
        ? (payload as { models: unknown[] }).models
        : [];
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.trim()) {
      ids.push(entry.trim());
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    // OpenAI / Anthropic: id; Codex CLI: slug
    const id =
      typeof rec.id === "string"
        ? rec.id
        : typeof rec.slug === "string"
          ? rec.slug
          : "";
    if (id.trim()) ids.push(id.trim());
  }
  return ids;
}

/** Copilot: only picker-enabled models with tool_calls (matches pi-ai oauth). */
export function parseCopilotSelectableIds(payload: unknown): string[] {
  const data = asRecord(payload)?.data;
  if (!Array.isArray(data)) throw new Error("Invalid Copilot models response");
  const ids: string[] = [];
  for (const raw of data) {
    const item = asRecord(raw);
    if (!item || typeof item.id !== "string") continue;
    const policy = asRecord(item.policy);
    const capabilities = asRecord(item.capabilities);
    const supports = asRecord(capabilities?.supports);
    if (item.model_picker_enabled !== true) continue;
    if (policy?.state === "disabled") continue;
    if (supports?.tool_calls === false) continue;
    ids.push(item.id);
  }
  return ids;
}

/**
 * Codex CLI ModelsResponse slugs.
 * Do NOT filter `supported_in_api` — Hermes notes that flag is for the public
 * OpenAI API; Codex OAuth backend still accepts some false slugs (e.g. spark).
 */
export function parseCodexModelIds(payload: unknown): string[] {
  const models = asRecord(payload)?.models;
  if (!Array.isArray(models)) {
    return parseOpenAIStyleIds(payload);
  }
  const ids: string[] = [];
  for (const raw of models) {
    const item = asRecord(raw);
    if (!item) continue;
    const slug = typeof item.slug === "string" ? item.slug : typeof item.id === "string" ? item.id : "";
    if (!slug) continue;
    const visibility = item.visibility;
    if (typeof visibility === "string" && visibility.toLowerCase() === "hidden") continue;
    ids.push(slug);
  }
  return ids;
}

/** ChatGPT OAuth JWT → account id (required by Codex models catalog). */
export function extractChatgptAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(payloadB64 + pad, "base64").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const id = json?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

async function authHeaders(
  provider: Provider,
  credential: Credential | undefined,
): Promise<ProviderHeaders | null> {
  if (!credential) return null;
  try {
    if (credential.type === "api_key") {
      const key = typeof credential.key === "string" ? credential.key.trim() : "";
      return key ? { Authorization: `Bearer ${key}` } : null;
    }
    if (credential.type === "oauth") {
      const oauth = provider.auth.oauth;
      if (oauth?.toAuth) {
        const resolved = await oauth.toAuth(credential);
        if (resolved.headers && Object.keys(resolved.headers).length > 0) return resolved.headers;
        if (resolved.apiKey) {
          // Anthropic OAuth stores access as apiKey for the messages API
          if (provider.id === "anthropic") {
            return {
              "x-api-key": resolved.apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            };
          }
          return { Authorization: `Bearer ${resolved.apiKey}` };
        }
      }
      const access = typeof credential.access === "string" ? credential.access : "";
      if (!access) return null;
      if (provider.id === "anthropic") {
        return { "x-api-key": access, "anthropic-version": ANTHROPIC_VERSION };
      }
      return { Authorization: `Bearer ${access}` };
    }
  } catch {
    return null;
  }
  return null;
}

function openaiCompatModelsUrl(providerId: string, baseUrl: string | undefined): string | null {
  if (!baseUrl?.trim()) return null;
  const base = baseUrl.replace(/\/+$/, "");
  if (providerId === "kimi-coding") return `${base}/v1/models`;
  return `${base}/models`;
}

function clientVersion(): string {
  try {
    // Avoid bundling package.json into every consumer — soft default.
    return process.env.npm_package_version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

type LiveFetchPlan = {
  url: string;
  headers: ProviderHeaders;
  parseIds: (payload: unknown) => string[];
};

async function planLiveFetch(
  provider: Provider,
  credential: Credential | undefined,
): Promise<LiveFetchPlan> {
  const headers = await authHeaders(provider, credential);
  if (!headers) throw new Error(`Provider ${provider.id} has no credential for models list`);

  switch (provider.id) {
    case "openai-codex": {
      const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(clientVersion())}`;
      const access =
        credential?.type === "oauth" && typeof credential.access === "string"
          ? credential.access
          : "";
      const accountId = access ? extractChatgptAccountId(access) : null;
      return {
        url,
        headers: {
          Accept: "application/json",
          ...headers,
          ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
        },
        parseIds: parseCodexModelIds,
      };
    }
    case "github-copilot": {
      const base = (provider.baseUrl || "https://api.individual.githubcopilot.com").replace(/\/+$/, "");
      return {
        url: `${base}/models`,
        headers: {
          Accept: "application/json",
          ...COPILOT_HEADERS,
          ...headers,
        },
        parseIds: parseCopilotSelectableIds,
      };
    }
    case "anthropic": {
      return {
        url: ANTHROPIC_MODELS_URL,
        headers: { Accept: "application/json", ...headers },
        parseIds: parseOpenAIStyleIds,
      };
    }
    default: {
      const url = openaiCompatModelsUrl(provider.id, provider.baseUrl);
      if (!url) throw new Error(`Provider ${provider.id} has no baseUrl for /models`);
      return {
        url,
        headers: { Accept: "application/json", ...headers },
        parseIds: parseOpenAIStyleIds,
      };
    }
  }
}

/**
 * Fetch live models from the provider's own API (rich parse when available).
 * Vendor-returned fields are locked; missing fields stay soft/editable.
 */
export async function fetchSubscriptionLiveModels(
  provider: Provider,
  options: {
    credential?: Credential;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<AnyModel[]> {
  if (!SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(provider.id)) {
    throw new Error(`Provider ${provider.id} has no subscription live models adapter`);
  }

  const plan = await planLiveFetch(provider, options.credential);
  const timeoutMs = options.timeoutMs ?? PROVIDER_LIVE_MODELS_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const headerInit: Record<string, string> = {};
  for (const [key, value] of Object.entries(plan.headers)) {
    if (typeof value === "string") headerInit[key] = value;
  }

  const response = await fetch(plan.url, {
    method: "GET",
    headers: headerInit,
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${provider.id} models HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  const json: unknown = await response.json();
  const baseline = provider.getModels() as AnyModel[];
  const baseUrl = provider.baseUrl || "";
  let projected: AnyModel[] = [];

  if (provider.id === "openai-codex") {
    const models = (json as { models?: unknown })?.models;
    const items = Array.isArray(models)
      ? models.filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
      : [];
    projected = codexModelsFromApi(provider.id, baseUrl || CODEX_MODELS_URL, items, baseline);
  } else if (provider.id === "github-copilot") {
    // Copilot returns availability list; full meta stays on static catalog.
    const ids = parseCopilotSelectableIds(json);
    projected = projectLiveModelIds(provider.id, ids, baseline);
    // Static baseline models are fully official (no soft map) — correct.
  } else if (
    provider.id === "openrouter"
    || provider.id === "xai"
    || provider.id === "kimi-coding"
    || provider.id === "anthropic"
  ) {
    // OpenRouter/Nous-style rich objects or Anthropic id list.
    const data = Array.isArray((json as { data?: unknown })?.data)
      ? (json as { data: unknown[] }).data
      : Array.isArray(json)
        ? json
        : [];
    const rows: OpenAIModelsRawRow[] = [];
    for (const entry of data) {
      if (typeof entry === "string" && entry) {
        rows.push({ id: entry, raw: { id: entry } });
      } else if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        const rec = entry as Record<string, unknown>;
        rows.push({ id: String(rec.id), name: typeof rec.name === "string" ? rec.name : undefined, raw: rec });
      }
    }
    if (provider.id === "anthropic") {
      // Anthropic list is usually bare ids/display_name — keep static baseline meta when known.
      const ids = rows.map((r) => r.id);
      projected = projectLiveModelIds(provider.id, ids, baseline);
    } else {
      projected = openAIModelsFromRichCatalog(
        provider.id,
        baseUrl || "https://openrouter.ai/api/v1",
        rows,
      ) as AnyModel[];
      // Prefer static SDK catalog when id is known — fully official (locked).
      // Vendor-only ids keep field-level soft/lock from rich parse.
      projected = projected.map((m) => {
        const known = baseline.find((b) => b.id === m.id);
        if (!known) return m;
        clearSoftCatalogMeta(provider.id, m.id);
        return {
          ...known,
          // Prefer richer live values when static is weaker/missing
          name: m.name && m.name !== m.id ? m.name : known.name,
          reasoning: known.reasoning || m.reasoning,
          contextWindow: Math.max(known.contextWindow || 0, m.contextWindow || 0) || known.contextWindow,
          maxTokens: Math.max(known.maxTokens || 0, m.maxTokens || 0) || known.maxTokens,
          input: (m.input?.length ?? 0) > (known.input?.length ?? 0) ? m.input : known.input,
          thinkingLevelMap: known.thinkingLevelMap || m.thinkingLevelMap,
        } as AnyModel;
      });
    }
  } else {
    const ids = plan.parseIds(json);
    projected = projectLiveModelIds(provider.id, ids, baseline);
  }

  if (projected.length === 0) {
    throw new Error(`${provider.id} models list empty or unusable`);
  }
  return projected;
}

/** @deprecated use fetchSubscriptionLiveModels */
export const fetchOpenAICompatibleModels = fetchSubscriptionLiveModels;

/**
 * Wrap a static builtin so refreshModels hits the provider's own models API.
 */
export function withSubscriptionLiveModelList(provider: Provider): Provider {
  if (!SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(provider.id)) return provider;

  const staticModels = provider.getModels().slice() as AnyModel[];
  let dynamicModels: AnyModel[] = [];
  let inflight: Promise<void> | undefined;

  return {
    ...provider,
    getModels: () => mergeModels(staticModels, dynamicModels),
    refreshModels: (context: RefreshModelsContext) => {
      inflight ??= (async () => {
        try {
          // Pi 0.84: restore from context.stored, mutate memory via publish().
          if (context.stored?.models?.length) {
            const restored = context.stored.models.filter((m) => m.provider === provider.id) as AnyModel[];
            if (!(await context.publish({
              update: () => {
                dynamicModels = restored;
              },
            }))) {
              return;
            }
          }
          if (!context.allowNetwork || context.signal.aborted) return;

          try {
            const live = await fetchSubscriptionLiveModels(provider, {
              credential: context.credential,
              signal: context.signal,
            });
            if (context.signal.aborted) return;
            await context.publish({
              persist: { models: live, checkedAt: Date.now() },
              update: () => {
                dynamicModels = live;
              },
            });
          } catch (error) {
            console.warn(
              `[provider-live-models] ${provider.id} live models failed; using static/store`,
              error,
            );
          }
        } finally {
          inflight = undefined;
        }
      })();
      return inflight;
    },
  };
}

/** @deprecated use withSubscriptionLiveModelList */
export const withOpenAICompatibleModelList = withSubscriptionLiveModelList;

/** Apply live-list wrappers to raw builtins (no pi.dev). */
export function attachProviderLiveModelLists(providers: readonly Provider[]): Provider[] {
  return providers.map((provider) => {
    if (provider.id === "radius") return provider;
    if (SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(provider.id)) {
      return withSubscriptionLiveModelList(provider);
    }
    return provider;
  });
}
