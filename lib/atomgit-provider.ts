/**
 * AtomGit CodingPlan subscription provider (server-only).
 *
 * Single owner of the AtomGit "订阅" integration: OAuth login via the AtomGit
 * platform broker (acs.atomgit.com), CodingPlan claim + model catalog via
 * api.gitcode.com, and OpenAI-compatible model calls against the
 * llm-api.atomgit.com gateway with per-request AtomCode v1 signature headers
 * (see lib/atomgit-signing.ts). Signing runs at the HTTP fetch boundary.
 *
 * Do not import from client components — use lib/atomgit-constants.ts.
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
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import {
  ATOMGIT_API_BASE_URL,
  ATOMGIT_DISPLAY_NAME,
  ATOMGIT_GATEWAY_BASE_URL,
  ATOMGIT_GATEWAY_HOSTS,
  ATOMGIT_PLATFORM_BASE_URL,
  ATOMGIT_PROVIDER_ID,
} from "./atomgit-constants";
import { ATOMGIT_CLIENT_VERSION, signAtomGitRequest } from "./atomgit-signing";
import { withDeepSeekCompat } from "./deepseek-compat";

export {
  ATOMGIT_PROVIDER_ID,
  ATOMGIT_DISPLAY_NAME,
  ATOMGIT_GATEWAY_BASE_URL,
} from "./atomgit-constants";

// ── Wire constants (mirror atomcode's defaults) ───────────────────────────────

/**
 * UA for CodingPlan REST (api.gitcode.com). Gateway chat calls use
 * `atomcode/<ver>` via toAuth / withGatewaySigning instead.
 */
const USER_AGENT = "pi-web/atomgit";

const PLATFORM_LOGIN_URL = `${ATOMGIT_PLATFORM_BASE_URL}/auth/login?provider=atomgit`;
const PLATFORM_CHECK_URL = `${ATOMGIT_PLATFORM_BASE_URL}/auth/check`;
const PLATFORM_TOKEN_URL = `${ATOMGIT_PLATFORM_BASE_URL}/auth/token`;
const PLATFORM_REFRESH_URL = `${ATOMGIT_PLATFORM_BASE_URL}/oauth/refresh`;
const API_CLAIM_URL = `${ATOMGIT_API_BASE_URL}/coding-plan/claim-v2`;
const API_MODELS_URL = `${ATOMGIT_API_BASE_URL}/coding-plan/models-v2`;
const API_STATUS_URL = `${ATOMGIT_API_BASE_URL}/coding-plan/status-v2`;

/** CodingPlan tiers, tried highest first (server contract, case-sensitive). */
const PLAN_TIERS = ["Max", "Pro", "Lite"] as const;

/** Total login window and poll cadence (same 2s cadence as atomcode). */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

/** Floor for every CodingPlan model's context window (atomcode uses 128k). */
const MIN_CONTEXT_WINDOW = 128_000;

const DEFAULT_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": USER_AGENT,
} as const;

// ── Platform broker HTTP helpers ──────────────────────────────────────────────

interface PlatformLoginResponse {
  login_url?: unknown;
  state?: unknown;
}
interface PlatformCheckResponse {
  valid?: unknown;
}
interface PlatformUserInfo {
  id?: unknown;
  username?: unknown;
  name?: unknown;
  email?: unknown;
  avatar_url?: unknown;
}
interface PlatformTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  user?: PlatformUserInfo;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stripForceLogin(url: string): string {
  // The broker emits force_login=true to force re-auth; stripping it lets
  // already-signed-in users auto-authorize (same as atomcode).
  return url.replace("&force_login=true", "").replace("?force_login=true&", "?").replace("?force_login=true", "");
}

async function platformFetch(url: string, init: RequestInit = {}): Promise<Response> {
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

async function startPlatformLogin(): Promise<{ loginUrl: string; state: string }> {
  const res = await platformFetch(PLATFORM_LOGIN_URL);
  if (!res.ok) throw new Error(`AtomGit login start failed (HTTP ${res.status})`);
  const data = (await res.json().catch(() => null)) as PlatformLoginResponse | null;
  const state = asString(data?.state);
  const rawUrl = asString(data?.login_url);
  if (!state || !rawUrl) throw new Error("AtomGit login start returned no state/url");
  return { loginUrl: stripForceLogin(rawUrl), state };
}

async function pollAuthorized(state: string, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Login cancelled");
    try {
      const res = await platformFetch(`${PLATFORM_CHECK_URL}?state=${encodeURIComponent(state)}`);
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as PlatformCheckResponse | null;
        if (data?.valid === true) return;
      }
    } catch (error) {
      if (signal?.aborted) throw new Error("Login cancelled");
      // Transient network errors must not kill the poll loop — retry next tick.
      if (error instanceof TypeError) {
        // fetch network failure — keep polling
      } else {
        throw error;
      }
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
  throw new Error("AtomGit login timed out — please try again");
}

async function exchangeToken(state: string, signal?: AbortSignal): Promise<PlatformTokenResponse> {
  const res = await platformFetch(`${PLATFORM_TOKEN_URL}?state=${encodeURIComponent(state)}`, { signal });
  if (!res.ok) throw new Error(`AtomGit token exchange failed (HTTP ${res.status})`);
  const data = (await res.json()) as PlatformTokenResponse;
  if (!asString(data.access_token)) throw new Error("AtomGit token exchange returned no access token");
  return data;
}

async function refreshPlatformToken(refreshToken: string, signal?: AbortSignal): Promise<PlatformTokenResponse> {
  const res = await platformFetch(PLATFORM_REFRESH_URL, {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal,
  });
  if (!res.ok) throw new Error(`AtomGit token refresh failed (HTTP ${res.status})`);
  const data = (await res.json()) as PlatformTokenResponse;
  if (!asString(data.access_token)) throw new Error("AtomGit token refresh returned no access token");
  return data;
}

// ── CodingPlan REST API helpers ───────────────────────────────────────────────

interface ClaimResponse {
  success?: unknown;
  duplicate?: unknown;
  message?: unknown;
  plan_name?: unknown;
}

interface ModelEntry {
  display_model_name?: unknown;
  base_url?: unknown;
  type?: unknown;
  context_window?: unknown;
  plan_available?: unknown;
}

interface StatusResponse {
  codingplan_free?: { plan_name?: unknown } | null;
}

/** Map a status plan_name ("CodingPlan Pro") back to a claim tier; Max fallback. */
function planTierFromPlanName(planName: string): string {
  const lower = planName.toLowerCase();
  if (lower.includes("max")) return "Max";
  if (lower.includes("pro")) return "Pro";
  if (lower.includes("lite")) return "Lite";
  return "Max";
}

async function apiGet<T>(url: string, accessToken: string, signal?: AbortSignal): Promise<T> {
  const res = await platformFetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!res.ok) throw new Error(`AtomGit API ${url} failed (HTTP ${res.status})`);
  return (await res.json()) as T;
}

async function apiPost(url: string, accessToken: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return platformFetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Best-effort CodingPlan claim: walk Max → Pro → Lite and stop at the first
 * tier the server reports as claimed/duplicate. Never fatal — a failed claim
 * only means the plan stays as-is and model availability filters downstream.
 */
async function claimCodingPlan(accessToken: string, signal?: AbortSignal): Promise<string> {
  for (const tier of PLAN_TIERS) {
    if (signal?.aborted) throw new Error("Login cancelled");
    try {
      const res = await apiPost(API_CLAIM_URL, accessToken, { plan_type: tier }, signal);
      if (res.status === 401 || res.status === 403) return "";
      const data = (await res.json().catch(() => null)) as ClaimResponse | null;
      if (res.ok && (data?.success === true || data?.duplicate === true)) {
        const planName = asString(data?.plan_name);
        return planName || `CodingPlan ${tier}`;
      }
    } catch {
      // Transport error on one tier — continue the cascade.
    }
  }
  return "";
}

/** Resolve the user's actual plan tier (status-v2), falling back to Max. */
async function resolvePlanTier(accessToken: string, signal?: AbortSignal): Promise<string> {
  try {
    const status = await apiGet<StatusResponse>(API_STATUS_URL, accessToken, signal);
    return planTierFromPlanName(asString(status?.codingplan_free?.plan_name));
  } catch {
    return "Max";
  }
}

// ── Model catalog ─────────────────────────────────────────────────────────────

/** Reasoning-capable model families seen on the CodingPlan gateway. */
/** Reasoning-capable model families seen on the CodingPlan gateway. */
const REASONING_MODEL_RE = /(r1|thinking|reasoner|-k2|k2-|glm-5|glm-4\.6|qwen3|minimax-m2|deepseek-v3|deepseek-v4|kimi)/i;
/** Vision-capable model families. */
const VISION_MODEL_RE = /(vl|vision|4v|omni|multi.?modal|glm-4v|qwen2\.5-vl|qwen3-vl)/i;

function toModel(entry: ModelEntry, gatewayBase: string): Model<"openai-completions"> | null {
  const id = asString(entry.display_model_name).trim();
  if (!id || entry.plan_available !== true) return null;
  const baseUrl = asString(entry.base_url).trim() || gatewayBase;
  const contextWindow = Math.max(
    typeof entry.context_window === "number" && entry.context_window > 0 ? entry.context_window : MIN_CONTEXT_WINDOW,
    MIN_CONTEXT_WINDOW,
  );
  return withDeepSeekCompat({
    id,
    name: id,
    api: "openai-completions",
    provider: ATOMGIT_PROVIDER_ID,
    baseUrl,
    reasoning: REASONING_MODEL_RE.test(id),
    input: VISION_MODEL_RE.test(id) ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(128_000, Math.max(8_192, Math.floor(contextWindow / 4))),
  } as Model<"openai-completions">);
}

async function fetchGatewayModels(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
  const tier = await resolvePlanTier(accessToken, signal);
  const entries = await apiGet<ModelEntry[]>(`${API_MODELS_URL}?plan_type=${tier}`, accessToken, signal);
  if (!Array.isArray(entries)) throw new Error("AtomGit models endpoint returned no list");
  const models = entries
    .map((entry) => toModel(entry, ATOMGIT_GATEWAY_BASE_URL))
    .filter((m): m is Model<"openai-completions"> => m !== null);
  if (models.length === 0) throw new Error("AtomGit returned no available models on your plan");
  return models;
}

async function fetchAtomGitModels(
  context: RefreshModelsContext,
): Promise<readonly Model<"openai-completions">[]> {
  // createProvider owns restore/publish; only return the next overlay catalog.
  const storedModels = (context.stored?.models ?? []).filter(
    (m): m is Model<"openai-completions"> => m.provider === ATOMGIT_PROVIDER_ID && m.api === "openai-completions",
  );

  const token = context.credential?.type === "oauth" ? context.credential.access : "";
  if (!context.allowNetwork || !token) return storedModels;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  context.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetchGatewayModels(token, controller.signal);
  } catch {
    // Soft-fail with the last stored catalog; the login/refresh UI reports live=false.
    return storedModels;
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", onAbort);
  }
}

// ── Gateway request signing (fetch boundary) ──────────────────────────────────

function isGatewayUrl(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    return ATOMGIT_GATEWAY_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

function bodyToBuffer(body: BodyInit | null | undefined): Buffer {
  if (body == null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === "object" && "body" in body && typeof body.body === "string") return Buffer.from(body.body);
  // FormData/Blob/stream bodies are never used by chat completions.
  return Buffer.from(String(body));
}

/** Latest OAuth snapshot for the fetch-boundary signer, refreshed by toAuth(). */
let authSnapshot: { token: string; userId: string } | null = null;

/**
 * Wrap a fetch so requests to the AtomGit LLM gateway carry AtomCode v1
 * signature headers over the exact bytes being sent. Other URLs pass through.
 */
function withGatewaySigning(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    const auth = authSnapshot;
    if (!auth || !isGatewayUrl(input)) return inner(input, init);
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = bodyToBuffer(init?.body);
    const headers = signAtomGitRequest({
      method,
      path: url.pathname,
      body,
      oauthToken: auth.token,
      userId: auth.userId,
      clientVersion: ATOMGIT_CLIENT_VERSION,
    });
    const merged = new Headers(init?.headers);
    for (const [key, value] of Object.entries(headers)) merged.set(key, value);
    merged.set("authorization", `Bearer ${auth.token}`);
    // Gateway UA filter expects atomcode/<version>.
    if (!merged.has("user-agent")) {
      merged.set("user-agent", `atomcode/${ATOMGIT_CLIENT_VERSION}`);
    }
    return inner(url, { ...init, headers: merged });
  };
}

/** OpenAI-completions streams with the gateway signer wired into every request. */
function signedOpenAICompletionsApi(): ProviderStreams {
  const inner = openAICompletionsApi();
  return {
    stream(model, context, options) {
      const fetchWithSigning = options?.fetch ? withGatewaySigning(options.fetch) : withGatewaySigning(fetch);
      return inner.stream(model, context, { ...options, fetch: fetchWithSigning });
    },
    streamSimple(model, context, options) {
      const fetchWithSigning = options?.fetch ? withGatewaySigning(options.fetch) : withGatewaySigning(fetch);
      return inner.streamSimple(model, context, { ...options, fetch: fetchWithSigning });
    },
  };
}

// ── OAuth auth implementation ─────────────────────────────────────────────────

const atomGitOAuth: OAuthAuth = {
  name: "AtomGit Coding Plan",
  loginLabel: "使用 AtomGit 账号登录",
  async login(interaction: AuthInteraction): Promise<OAuthCredential> {
    const { loginUrl, state } = await startPlatformLogin();
    interaction.notify({
      type: "auth_url",
      url: loginUrl,
      instructions: "在浏览器中完成 AtomGit 登录。若浏览器没有自动打开，请点击下方链接。",
    });
    await pollAuthorized(state, interaction.signal);
    const tokenResp = await exchangeToken(state, interaction.signal);

    // Claim the CodingPlan subscription (best-effort) so the plan is active
    // before the model catalog is fetched.
    let planName = "";
    try {
      planName = await claimCodingPlan(asString(tokenResp.access_token), interaction.signal);
    } catch {
      // Non-fatal — plan may already be claimed; catalog refresh reports it.
    }
    if (planName) {
      interaction.notify({ type: "progress", message: `CodingPlan：${planName}` });
    }

    const userId = asString(tokenResp.user?.id);
    const expiresIn = typeof tokenResp.expires_in === "number" ? tokenResp.expires_in : 7 * 24 * 3600;
    return {
      type: "oauth",
      access: asString(tokenResp.access_token),
      refresh: asString(tokenResp.refresh_token),
      expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
      userId,
      username: asString(tokenResp.user?.username),
      user: tokenResp.user ?? {},
    };
  },
  async refresh(credential: OAuthCredential, signal?: AbortSignal): Promise<OAuthCredential> {
    if (!credential.refresh) throw new Error("AtomGit 登录已过期，请重新登录");
    const data = await refreshPlatformToken(credential.refresh, signal);
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7 * 24 * 3600;
    return {
      ...credential,
      access: asString(data.access_token),
      refresh: asString(data.refresh_token) || credential.refresh,
      expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
      ...(data.user ? { user: data.user } : {}),
    };
  },
  async toAuth(credential: OAuthCredential) {
    const token = credential.access;
    const userId = typeof credential.userId === "string" ? credential.userId : "";
    // Snapshot for the fetch-boundary signer (per-request headers).
    authSnapshot = { token, userId };
    return {
      apiKey: token,
      headers: {
        "user-agent": `atomcode/${ATOMGIT_CLIENT_VERSION}`,
        // Static user id helps gateway attribution; body signature is per-request.
        ...(userId ? { "x-atom-user-id": userId } : {}),
      },
    };
  },
};

// ── Provider factory ──────────────────────────────────────────────────────────

export function createAtomGitProvider(): Provider<"openai-completions"> {
  return createProvider({
    id: ATOMGIT_PROVIDER_ID,
    name: ATOMGIT_DISPLAY_NAME,
    baseUrl: ATOMGIT_GATEWAY_BASE_URL,
    auth: { oauth: atomGitOAuth },
    models: [],
    fetchModels: fetchAtomGitModels,
    api: signedOpenAICompletionsApi(),
  });
}
