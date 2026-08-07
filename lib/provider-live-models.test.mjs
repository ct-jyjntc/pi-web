/** Subscription live model parsers + wrappers. */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  projectLiveModelIds,
  SUBSCRIPTION_LIVE_MODEL_PROVIDERS,
  parseCodexModelIds,
  parseCopilotSelectableIds,
  withSubscriptionLiveModelList,
} = await jiti.import("./provider-live-models.ts");

test("subscription live set includes codex/copilot/anthropic + openai-compat", () => {
  for (const id of [
    "kimi-coding",
    "xai",
    "openrouter",
    "openai-codex",
    "github-copilot",
    "anthropic",
    "nous",
    "minimax-oauth",
  ]) {
    assert.equal(SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has(id), true, id);
  }
  assert.equal(SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has("openai"), false);
  assert.equal(SUBSCRIPTION_LIVE_MODEL_PROVIDERS.has("groq"), false);
});

test("parseCodexModelIds reads slug list (CLI/Hermes shape)", () => {
  const ids = parseCodexModelIds({
    models: [
      { slug: "gpt-5.6-luna", visibility: "list", supported_in_api: true },
      { slug: "hidden-one", visibility: "hidden", supported_in_api: true },
      // supported_in_api:false still kept (Codex backend accepts some of these)
      { slug: "gpt-5.3-codex-spark", visibility: "list", supported_in_api: false },
      { id: "fallback-id" },
    ],
  });
  assert.deepEqual(ids, ["gpt-5.6-luna", "gpt-5.3-codex-spark", "fallback-id"]);
});

test("parseCopilotSelectableIds filters picker + tools", () => {
  const ids = parseCopilotSelectableIds({
    data: [
      {
        id: "claude-sonnet-4",
        model_picker_enabled: true,
        policy: { state: "enabled" },
        capabilities: { supports: { tool_calls: true } },
      },
      {
        id: "disabled-model",
        model_picker_enabled: true,
        policy: { state: "disabled" },
        capabilities: { supports: { tool_calls: true } },
      },
      {
        id: "no-tools",
        model_picker_enabled: true,
        policy: { state: "enabled" },
        capabilities: { supports: { tool_calls: false } },
      },
      {
        id: "not-in-picker",
        model_picker_enabled: false,
        policy: { state: "enabled" },
        capabilities: { supports: { tool_calls: true } },
      },
    ],
  });
  assert.deepEqual(ids, ["claude-sonnet-4"]);
});

test("projectLiveModelIds prefers static metadata for known ids", () => {
  const baseline = [
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      provider: "openai-codex",
      api: "openai-codex-responses",
      reasoning: true,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      baseUrl: "https://chatgpt.com/backend-api",
    },
  ];
  const out = projectLiveModelIds("openai-codex", ["gpt-5.6-luna", "brand-new"], baseline);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "GPT-5.6 Luna");
  assert.equal(out[1].id, "brand-new");
});

test("withSubscriptionLiveModelList adds refreshModels for codex", () => {
  const base = {
    id: "openai-codex",
    name: "OpenAI Codex",
    baseUrl: "https://chatgpt.com/backend-api",
    auth: {},
    getModels: () => [
      { id: "a", name: "A", provider: "openai-codex", api: "openai-codex-responses" },
    ],
    stream: () => {
      throw new Error("unused");
    },
    streamSimple: () => {
      throw new Error("unused");
    },
  };
  const wrapped = withSubscriptionLiveModelList(base);
  assert.equal(typeof wrapped.refreshModels, "function");
});
