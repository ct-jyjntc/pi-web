/**
 * RAINFLOWTB subscription provider (server-only).
 *
 * Single owner of the RAINFLOWTB integration: OAuth broker login (login_url +
 * state polling + token exchange), a channel picker shown after login
 * (subscription `/coding/v1` vs wallet `/v1`), the OpenAI-compatible model
 * catalog from the chosen channel, and standard chat completions against it.
 *
 * RAINFLOWTB runs the LocalApi OAuth broker service at api.rainflowtb.com —
 * endpoints under /oauth/* per the LocalApi repo, docs/pi-web-oauth.md. The
 * provider contract mirrors lib/atomgit-provider.ts.
 *
 * Do not import from client components — use lib/rainflowtb-constants.ts.
 */
import {
  createProvider,
  type AuthInteraction,
  type Model,
  type OAuthAuth,
  type OAuthCredential,
  type Provider,
  type ProviderStreams,
  type RefreshModelsContext,
  type ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  RAINFLOWTB_CHECK_URL,
  RAINFLOWTB_CODING_BASE_URL,
  RAINFLOWTB_DISPLAY_NAME,
  RAINFLOWTB_LOGIN_URL,
  RAINFLOWTB_PROVIDER_ID,
  RAINFLOWTB_REFRESH_URL,
  RAINFLOWTB_TOKEN_URL,
  RAINFLOWTB_WALLET_BASE_URL,
} from "./rainflowtb-constants";
export {
  RAINFLOWTB_PROVIDER_ID,
  RAINFLOWTB_DISPLAY_NAME,
  RAINFLOWTB_BASE_URL,
} from "./rainflowtb-constants";

/** Total login window and poll cadence (same shape as the AtomGit provider). */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 2_000;

const DEFAULT_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
} as const;

type Channel = "coding" | "wallet";

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  user?: { id?: unknown; username?: unknown; display_name?: unknown };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(DEFAULT_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return fetch(url, { ...init, headers, cache: "no-store" });
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Login cancelled"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

// ── Broker HTTP helpers ─────────────────────────────────────────────────────

interface LoginStart {
  login_url?: unknown;
  state?: unknown;
}

async function startLogin(): Promise<{ loginUrl: string; state: string }> {
  const res = await apiFetch(RAINFLOWTB_LOGIN_URL);
  if (!res.ok) throw new Error(`RAINFLOWTB login start failed (HTTP ${res.status})`);
  const data = (await res.json().catch(() => null)) as LoginStart | null;
  const state = asString(data?.state);
  const loginUrl = asString(data?.login_url);
  if (!state || !loginUrl) throw new Error("RAINFLOWTB login start returned no state/url");
  return { loginUrl, state };
}

async function pollAuthorized(state: string, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Login cancelled");
    try {
      const res = await apiFetch(`${RAINFLOWTB_CHECK_URL}?state=${encodeURIComponent(state)}`);
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { valid?: unknown } | null;
        if (data?.valid === true) return;
      }
    } catch (error) {
      if (signal?.aborted) throw new Error("Login cancelled");
      if (!(error instanceof TypeError)) throw error;
      // Transient network error — keep polling.
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
  throw new Error("RAINFLOWTB login timed out — please try again");
}

async function exchangeToken(state: string, signal?: AbortSignal): Promise<TokenResponse> {
  const res = await apiFetch(`${RAINFLOWTB_TOKEN_URL}?state=${encodeURIComponent(state)}`, { signal });
  if (!res.ok) throw new Error(`RAINFLOWTB token exchange failed (HTTP ${res.status})`);
  const data = (await res.json()) as TokenResponse;
  if (!asString(data.access_token)) throw new Error("RAINFLOWTB token exchange returned no access token");
  return data;
}

async function refreshBrokerToken(refreshToken: string, signal?: AbortSignal): Promise<TokenResponse> {
  const res = await apiFetch(RAINFLOWTB_REFRESH_URL, {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal,
  });
  if (!res.ok) throw new Error(`RAINFLOWTB token refresh failed (HTTP ${res.status})`);
  const data = (await res.json()) as TokenResponse;
  if (!asString(data.access_token)) throw new Error("RAINFLOWTB token refresh returned no access token");
  return data;
}

// ── OAuth auth implementation ───────────────────────────────────────────────

const rainflowtbOAuth: OAuthAuth = {
  name: RAINFLOWTB_DISPLAY_NAME,
  loginLabel: "使用 RAINFLOWTB 账号登录",
  async login(interaction: AuthInteraction): Promise<OAuthCredential> {
    const { loginUrl, state } = await startLogin();
    interaction.notify({
      type: "auth_url",
      url: loginUrl,
      instructions:
        "在浏览器中完成 RAINFLOWTB 登录并授权。若浏览器没有自动打开，请点击下方链接。",
    });
    await pollAuthorized(state, interaction.signal);
    const tokenResp = await exchangeToken(state, interaction.signal);

    // Channel pick: subscription plan vs wallet. Chosen after login, before
    // any model call — the model catalog and chat base URL follow the pick.
    const channel = await interaction.prompt({
      type: "select",
      message: "选择 RAINFLOWTB 调用通道",
      options: [
        {
          id: "coding",
          label: "订阅套餐（Coding Plan）",
          description: "按订阅配额调用 /coding/v1/*，无有效订阅时提示购买",
        },
        {
          id: "wallet",
          label: "普通 API（按量计费）",
          description: "按钱包余额调用 /v1/*",
        },
      ],
    });

    const expiresIn = typeof tokenResp.expires_in === "number" ? tokenResp.expires_in : 7 * 24 * 3600;
    return {
      type: "oauth",
      access: asString(tokenResp.access_token),
      refresh: asString(tokenResp.refresh_token),
      expires: Date.now() + expiresIn * 1000 - 5 * 60_000,
      userId: asString(tokenResp.user?.id),
      username: asString(tokenResp.user?.username),
      channel: channel === "coding" ? ("coding" as Channel) : ("wallet" as Channel),
    };
  },
  async refresh(credential: OAuthCredential, signal?: AbortSignal): Promise<OAuthCredential> {
    if (!credential.refresh) throw new Error("RAINFLOWTB 登录已过期，请重新登录");
    const data = await refreshBrokerToken(credential.refresh, signal);
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7 * 24 * 3600;
    return {
      ...credential,
      access: asString(data.access_token),
      refresh: asString(data.refresh_token) || credential.refresh,
      expires: Date.now() + expiresIn * 1000 - 5 * 60_000,
      ...(data.user?.id != null ? { userId: asString(data.user.id) } : {}),
      ...(data.user?.username != null ? { username: asString(data.user.username) } : {}),
    };
  },
  async toAuth(credential: OAuthCredential) {
    return {
      apiKey: credential.access,
      baseUrl: channelBaseUrl(credential.channel as Channel | undefined),
    };
  },
};

function channelBaseUrl(channel: Channel | undefined): string {
  return channel === "coding" ? RAINFLOWTB_CODING_BASE_URL : RAINFLOWTB_WALLET_BASE_URL;
}

// ── Model catalog ───────────────────────────────────────────────────────────

interface CatalogRow {
  id: string;
  name?: string;
  reasoning?: { enabled?: unknown; effort?: unknown };
  image_input?: unknown;
  context_window?: unknown;
  max_output_tokens?: unknown;
}

/**
 * RAINFLOWTB exposes reasoning as { enabled, effort: string[] } per model.
 * Pi models map it to `reasoning` plus a `thinkingLevelMap`: supported
 * efforts become the matching pi levels, missing ones are marked null
 * (unsupported). An empty effort list means "upstream default" — no map.
 * RAINFLOWTB also allows an "ultra" effort, which has no pi level — it is
 * not advertised to Pi-Web (the relay still passes it through on requests).
 */
function buildThinkingLevelMap(reasoning: CatalogRow["reasoning"]): ThinkingLevelMap | undefined {
  if (!reasoning || !Array.isArray(reasoning.effort)) return undefined;
  const efforts = reasoning.effort.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (efforts.length === 0) return undefined;
  return {
    minimal: efforts.includes("minimal") ? "minimal" : null,
    low: efforts.includes("low") ? "low" : null,
    medium: efforts.includes("medium") ? "medium" : null,
    high: efforts.includes("high") ? "high" : null,
    xhigh: efforts.includes("xhigh") ? "xhigh" : null,
    max: efforts.includes("max") ? "max" : null,
  };
}

/** Positive token value when the catalog row declares one; fallback otherwise. */
function toTokenCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** OpenAI-compatible /models rows → soft placeholder models (all fields editable). */
function toModels(rows: readonly CatalogRow[], baseUrl: string): Model<"openai-completions">[] {
  return rows.map((row) => {
    const thinkingLevelMap = buildThinkingLevelMap(row.reasoning);
    const imageInput = row.image_input === true;
    return {
      id: row.id,
      name: row.name || row.id,
      api: "openai-completions",
      provider: RAINFLOWTB_PROVIDER_ID,
      baseUrl,
      reasoning: row.reasoning?.enabled === true,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      input: imageInput ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: toTokenCount(row.context_window, 128_000),
      maxTokens: toTokenCount(row.max_output_tokens, 16_384),
    };
  });
}

async function fetchRainflowtbModels(context: RefreshModelsContext): Promise<readonly Model<"openai-completions">[]> {
  const storedModels = (context.stored?.models ?? []).filter(
    (m): m is Model<"openai-completions"> => m.provider === RAINFLOWTB_PROVIDER_ID && m.api === "openai-completions",
  );
  const token = context.credential?.type === "oauth" ? context.credential.access : "";
  if (!context.allowNetwork || !token) return storedModels;

  const channel = context.credential?.type === "oauth"
    ? ((context.credential as OAuthCredential & { channel?: Channel }).channel)
    : undefined;
  const baseUrl = channelBaseUrl(channel);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  context.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await apiFetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 402) {
      throw new Error("RAINFLOWTB：当前账号没有有效的订阅套餐（Coding Plan）。请先在 RAINFLOWTB 购买套餐，或重新登录选择普通 API 通道。");
    }
    if (!res.ok) throw new Error(`RAINFLOWTB models failed (HTTP ${res.status})`);
    const json = (await res.json()) as { data?: unknown } | unknown[] | null;
    const data = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown })?.data) ? (json as { data: unknown[] }).data : [];
    const rows: CatalogRow[] = [];
    for (const entry of data) {
      if (typeof entry === "string" && entry) {
        rows.push({ id: entry });
      } else if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        const rec = entry as CatalogRow & { id: string };
        rows.push({
          id: rec.id,
          name: typeof rec.name === "string" ? rec.name : undefined,
          ...(rec.reasoning && typeof rec.reasoning === "object"
            ? {
                reasoning: {
                  enabled: rec.reasoning.enabled,
                  effort: rec.reasoning.effort,
                },
              }
            : {}),
          // Parse-time extraction — these must be copied or toModels never sees them.
          ...(rec.image_input !== undefined ? { image_input: rec.image_input } : {}),
          ...(rec.context_window !== undefined ? { context_window: rec.context_window } : {}),
          ...(rec.max_output_tokens !== undefined ? { max_output_tokens: rec.max_output_tokens } : {}),
        });
      }
    }
    if (rows.length === 0) throw new Error("RAINFLOWTB returned no models");
    return toModels(rows, baseUrl);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RAINFLOWTB：")) {
      throw error; // actionable subscription error — surface it
    }
    // Soft-fail with the last stored catalog; the login/refresh UI reports live=false.
    return storedModels;
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", onAbort);
  }
}

// ── Provider factory ────────────────────────────────────────────────────────

export function createRainflowtbProvider(): Provider<"openai-completions"> {
  return createProvider({
    id: RAINFLOWTB_PROVIDER_ID,
    name: RAINFLOWTB_DISPLAY_NAME,
    baseUrl: RAINFLOWTB_WALLET_BASE_URL,
    auth: { oauth: rainflowtbOAuth },
    models: [],
    fetchModels: fetchRainflowtbModels,
    api: openAICompletionsApi(),
  });
}

// Re-export for tree-shaking symmetry with the other native providers.
export type { ProviderStreams };
