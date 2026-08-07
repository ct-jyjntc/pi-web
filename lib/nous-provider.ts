/**
 * Nous Portal subscription (server-only).
 * Device-code OAuth → inference-api.nousresearch.com (OpenAI-compatible).
 * Ported from Hermes hermes_cli/auth.py device flow (not pi.dev).
 */
import {
  createProvider,
  type AuthInteraction,
  type Model,
  type OAuthAuth,
  type OAuthCredential,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import {
  asNumber,
  asString,
  fetchOpenAIModelsRaw,
  formBody,
  openAIModel,
  openAIModelsFromRichCatalog,
  readJson,
  sleep,
} from "./subscription-oauth-shared";

export const NOUS_PROVIDER_ID = "nous";
export const NOUS_DISPLAY_NAME = "Nous Portal";
const PORTAL = "https://portal.nousresearch.com";
const INFERENCE = "https://inference-api.nousresearch.com/v1";
const CLIENT_ID = "hermes-cli";
const SCOPE = "inference:invoke";

const FALLBACK_MODELS = ["hermes-4-70b", "hermes-4-405b", "hermes-3-70b"];

async function deviceLogin(interaction: AuthInteraction): Promise<OAuthCredential> {
  const res = await fetch(`${PORTAL}/api/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({ client_id: CLIENT_ID, scope: SCOPE }),
    signal: interaction.signal,
  });
  if (!res.ok) throw new Error(`Nous device authorization failed (HTTP ${res.status})`);
  const data = await readJson(res);
  const deviceCode = asString(data?.device_code);
  const userCode = asString(data?.user_code);
  const verificationUri =
    asString(data?.verification_uri_complete) || asString(data?.verification_uri);
  const expiresIn = asNumber(data?.expires_in, 900);
  let interval = Math.max(1, asNumber(data?.interval, 5));
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("Nous device authorization response incomplete");
  }

  interaction.notify({
    type: "device_code",
    userCode,
    verificationUri,
    intervalSeconds: interval,
    expiresInSeconds: expiresIn,
  });

  const deadline = Date.now() + expiresIn * 1000;
  await sleep(Math.min(interval, 5) * 1000, interaction.signal);

  while (Date.now() < deadline) {
    if (interaction.signal?.aborted) throw new Error("Login cancelled");
    const tokenRes = await fetch(`${PORTAL}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: formBody({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: deviceCode,
      }),
      signal: interaction.signal,
    });
    const payload = await readJson(tokenRes);
    if (tokenRes.ok && asString(payload?.access_token)) {
      const exp = asNumber(payload?.expires_in, 3600);
      const inference =
        asString(payload?.inference_base_url).replace(/\/+$/, "") || INFERENCE;
      return {
        type: "oauth",
        access: asString(payload?.access_token),
        refresh: asString(payload?.refresh_token),
        expires: Date.now() + exp * 1000 - 120_000,
        // custom fields survive in auth.json
        baseUrl: inference.endsWith("/v1") ? inference : `${inference}/v1`,
        scope: asString(payload?.scope) || SCOPE,
      } as OAuthCredential;
    }
    const err = asString(payload?.error);
    if (err === "authorization_pending") {
      await sleep(interval * 1000, interaction.signal);
      continue;
    }
    if (err === "slow_down") {
      interval = Math.min(interval + 1, 30);
      await sleep(interval * 1000, interaction.signal);
      continue;
    }
    if (err === "expired_token") throw new Error("Nous device code expired — try again");
    if (err === "access_denied") throw new Error("Nous login was denied");
    throw new Error(
      `Nous token error: ${err || tokenRes.status} ${asString(payload?.error_description)}`,
    );
  }
  throw new Error("Nous login timed out — finish Portal sign-in then retry");
}

async function refreshNous(credential: OAuthCredential, signal?: AbortSignal): Promise<OAuthCredential> {
  if (!credential.refresh) throw new Error("Nous login expired — please re-login");
  const res = await fetch(`${PORTAL}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: credential.refresh,
    }),
    signal,
  });
  const payload = await readJson(res);
  if (!res.ok || !asString(payload?.access_token)) {
    throw new Error(`Nous refresh failed (HTTP ${res.status})`);
  }
  const exp = asNumber(payload?.expires_in, 3600);
  return {
    ...credential,
    access: asString(payload?.access_token),
    refresh: asString(payload?.refresh_token) || credential.refresh,
    expires: Date.now() + exp * 1000 - 120_000,
  };
}

const oauth: OAuthAuth = {
  name: "Nous Portal",
  loginLabel: "Sign in with Nous Portal",
  login: deviceLogin,
  refresh: refreshNous,
  async toAuth(credential) {
    return { headers: { Authorization: `Bearer ${credential.access}` } };
  },
};

async function fetchModels(ctx: RefreshModelsContext): Promise<readonly Model<"openai-completions">[]> {
  // createProvider owns restore/publish; only return the next overlay catalog.
  const stored = (ctx.stored?.models ?? []).filter(
    (m): m is Model<"openai-completions"> => m.provider === NOUS_PROVIDER_ID,
  );
  const token = ctx.credential?.type === "oauth" ? ctx.credential.access : "";
  const credExtra = ctx.credential as OAuthCredential & { baseUrl?: string };
  const base =
    (typeof credExtra?.baseUrl === "string" && credExtra.baseUrl) || INFERENCE;

  let models: Model<"openai-completions">[] = stored.length
    ? stored.map((m) => openAIModel(NOUS_PROVIDER_ID, base, m.id, m.name))
    : FALLBACK_MODELS.map((id) => openAIModel(NOUS_PROVIDER_ID, base, id));

  if (ctx.allowNetwork && token) {
    try {
      const rows = await fetchOpenAIModelsRaw(base, token, ctx.signal);
      if (rows.length) {
        // Nous returns OpenRouter-style rich objects (reasoning, context_length, …).
        models = openAIModelsFromRichCatalog(NOUS_PROVIDER_ID, base, rows);
      }
    } catch {
      /* keep fallback / store */
    }
  }
  return models;
}

export function createNousProvider(): Provider<"openai-completions"> {
  return createProvider({
    id: NOUS_PROVIDER_ID,
    name: NOUS_DISPLAY_NAME,
    baseUrl: INFERENCE,
    auth: { oauth },
    models: FALLBACK_MODELS.map((id) => openAIModel(NOUS_PROVIDER_ID, INFERENCE, id)),
    fetchModels,
    api: openAICompletionsApi(),
  });
}
