/**
 * MiniMax OAuth subscription (server-only).
 * User-code + PKCE against api.minimax.io (Hermes minimax-oauth flow).
 * Transport: Anthropic Messages-compatible endpoint at /anthropic.
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
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  anthropicModel,
  asNumber,
  asString,
  formBody,
  readJson,
  sleep,
} from "./subscription-oauth-shared";

export const MINIMAX_PROVIDER_ID = "minimax-oauth";
export const MINIMAX_DISPLAY_NAME = "MiniMax (OAuth)";
const CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const SCOPE = "group_id profile model.completion";
const GRANT = "urn:ietf:params:oauth:grant-type:user_code";
const PORTAL = "https://api.minimax.io";
const INFERENCE = "https://api.minimax.io/anthropic";
const FALLBACK = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"];

function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(48).toString("base64url").slice(0, 96);
  const challenge = createHash("sha256").update(verifier).digest("base64url").replace(/=+$/, "");
  const state = randomBytes(12).toString("base64url");
  return { verifier, challenge, state };
}

function resolveExpiryUnix(expiredIn: number): number {
  const nowMs = Date.now();
  // Hermes: large values are absolute unix-ms; small values are TTL seconds
  if (expiredIn > nowMs / 2) return expiredIn / 1000;
  return Date.now() / 1000 + Math.max(1, expiredIn);
}

async function deviceLogin(interaction: AuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge, state } = pkce();
  const codeRes = await fetch(`${PORTAL}/oauth/code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: formBody({
      response_type: "code",
      client_id: CLIENT_ID,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }),
    signal: interaction.signal,
  });
  if (!codeRes.ok) throw new Error(`MiniMax OAuth start failed (HTTP ${codeRes.status})`);
  const codeData = await readJson(codeRes);
  if (asString(codeData?.state) && asString(codeData?.state) !== state) {
    throw new Error("MiniMax OAuth state mismatch");
  }
  const userCode = asString(codeData?.user_code);
  const verificationUri = asString(codeData?.verification_uri);
  const expiredIn = asNumber(codeData?.expired_in, 300);
  const intervalMs = asNumber(codeData?.interval, 2000);
  if (!userCode || !verificationUri) throw new Error("MiniMax OAuth response incomplete");

  interaction.notify({
    type: "device_code",
    userCode,
    verificationUri,
    intervalSeconds: Math.max(2, intervalMs / 1000),
    expiresInSeconds: expiredIn > 1e12 ? Math.max(60, (expiredIn - Date.now()) / 1000) : expiredIn,
  });

  const deadline = resolveExpiryUnix(expiredIn);
  let interval = Math.max(2, intervalMs / 1000);
  await sleep(interval * 1000, interaction.signal);

  while (Date.now() / 1000 < deadline) {
    if (interaction.signal?.aborted) throw new Error("Login cancelled");
    const tokenRes = await fetch(`${PORTAL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: formBody({
        grant_type: GRANT,
        client_id: CLIENT_ID,
        user_code: userCode,
        code_verifier: verifier,
      }),
      signal: interaction.signal,
    });
    const payload = await readJson(tokenRes);
    if (!tokenRes.ok) {
      throw new Error(`MiniMax OAuth error: HTTP ${tokenRes.status}`);
    }
    const status = asString(payload?.status);
    if (status === "error") throw new Error("MiniMax OAuth reported an error");
    if (status === "success" && asString(payload?.access_token)) {
      const expUnix = resolveExpiryUnix(asNumber(payload?.expired_in, 3600));
      return {
        type: "oauth",
        access: asString(payload?.access_token),
        refresh: asString(payload?.refresh_token),
        expires: expUnix * 1000 - 60_000,
        region: "global",
      } as OAuthCredential;
    }
    // pending
    await sleep(interval * 1000, interaction.signal);
  }
  throw new Error("MiniMax OAuth timed out");
}

async function refreshMinimax(credential: OAuthCredential, signal?: AbortSignal): Promise<OAuthCredential> {
  if (!credential.refresh) throw new Error("MiniMax login expired — please re-login");
  const res = await fetch(`${PORTAL}/oauth/token`, {
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
  if (!res.ok || asString(payload?.status) !== "success" || !asString(payload?.access_token)) {
    throw new Error(`MiniMax refresh failed (HTTP ${res.status})`);
  }
  const expUnix = resolveExpiryUnix(asNumber(payload?.expired_in, 3600));
  return {
    ...credential,
    access: asString(payload?.access_token),
    refresh: asString(payload?.refresh_token) || credential.refresh,
    expires: expUnix * 1000 - 60_000,
  };
}

const oauth: OAuthAuth = {
  name: "MiniMax (OAuth)",
  loginLabel: "Sign in with MiniMax",
  login: deviceLogin,
  refresh: refreshMinimax,
  async toAuth(credential) {
    // Anthropic-messages adapter expects apiKey style for x-api-key
    return { apiKey: credential.access };
  },
};

async function fetchModels(_ctx: RefreshModelsContext): Promise<readonly Model<"anthropic-messages">[]> {
  // Static catalog for now; createProvider still persists via publish when force-refreshed.
  return FALLBACK.map((id) => anthropicModel(MINIMAX_PROVIDER_ID, INFERENCE, id));
}

export function createMinimaxProvider(): Provider<"anthropic-messages"> {
  return createProvider({
    id: MINIMAX_PROVIDER_ID,
    name: MINIMAX_DISPLAY_NAME,
    baseUrl: INFERENCE,
    auth: { oauth },
    models: FALLBACK.map((id) => anthropicModel(MINIMAX_PROVIDER_ID, INFERENCE, id)),
    fetchModels,
    api: anthropicMessagesApi(),
  });
}
