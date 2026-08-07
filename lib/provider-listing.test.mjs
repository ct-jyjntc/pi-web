import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./provider-listing.ts");
  } catch {
    return import("./provider-listing.ts");
  }
}

const { buildApiKeyProviderList, buildOAuthProviderList } = await loadSubject();

const provider = (overrides) => ({
  id: "anthropic",
  name: "Anthropic",
  hasApiKeyLogin: true,
  hasOAuth: true,
  oauthName: "Anthropic (Claude Pro/Max)",
  status: { configured: false },
  modelCount: 12,
  ...overrides,
});

test("API-key list is always empty (custom covers keys; subscription is OAuth)", () => {
  const providers = [
    provider({
      id: "openai",
      name: "OpenAI",
      hasOAuth: false,
      status: { configured: true, source: "environment" },
    }),
    provider({
      id: "tokenrhythm",
      name: "基元律动",
      hasOAuth: false,
      status: { configured: true, source: "stored" },
      credentialType: "api_key",
    }),
    provider({ status: { configured: true, source: "stored" }, credentialType: "api_key" }),
  ];
  assert.deepEqual(buildApiKeyProviderList(providers), []);
});

test("subscription OAuth providers still list", () => {
  const providers = [
    provider({ status: { configured: true, source: "stored" }, credentialType: "oauth" }),
    provider({
      id: "openai-codex",
      name: "OpenAI Codex",
      hasApiKeyLogin: false,
      oauthName: "Sign in with ChatGPT",
    }),
    provider({ id: "xai", name: "xAI", oauthName: undefined }),
  ];
  assert.deepEqual(
    buildOAuthProviderList(providers).map((p) => [p.id, p.loggedIn, p.name]),
    [
      ["anthropic", true, "Anthropic (Claude Pro/Max)"],
      ["openai-codex", false, "ChatGPT Plus/Pro"],
      ["xai", false, "xAI"],
    ],
  );
});

test("custom models.json sources do not create API-key rows", () => {
  const providers = [
    provider({
      id: "acme",
      hasOAuth: false,
      status: { configured: true, source: "models_json_key" },
    }),
  ];
  assert.deepEqual(buildApiKeyProviderList(providers), []);
});
