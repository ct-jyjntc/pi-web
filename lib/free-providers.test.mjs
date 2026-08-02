import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./free-providers.ts");
  } catch {
    return import("./free-providers.ts");
  }
}

const {
  FREE_PROVIDERS,
  buildFreeModelEntries,
  filterFreeModelIds,
  freeProviderByKey,
  getFreeProvider,
  isFreeManagedProvider,
  mergeFreeModelEntries,
} = await loadSubject();

test("catalog includes OpenCode Zen free provider", () => {
  const def = getFreeProvider("opencode-zen-free");
  assert.ok(def);
  assert.equal(def.providerKey, "opencode-zen");
  assert.equal(def.baseUrl, "https://opencode.ai/zen/v1");
  assert.equal(def.catalogProviderId, "opencode");
  assert.equal(freeProviderByKey("opencode-zen")?.id, "opencode-zen-free");
  assert.equal(FREE_PROVIDERS.length >= 1, true);
});

test("filters only -free model ids", () => {
  const def = getFreeProvider("opencode-zen-free");
  assert.ok(def);
  const ids = filterFreeModelIds(def, [
    "claude-sonnet-4",
    "deepseek-v4-flash-free",
    "deepseek-v4-flash-free",
    "  mimo-v2.5-free  ",
    "",
    "gpt-5",
  ]);
  assert.deepEqual(ids, ["deepseek-v4-flash-free", "mimo-v2.5-free"]);
});

test("detects managed free providers", () => {
  assert.equal(isFreeManagedProvider({ managed: "opencode-zen-free" }), true);
  assert.equal(isFreeManagedProvider({ managed: "nope" }), false);
  assert.equal(isFreeManagedProvider({}), false);
  assert.equal(isFreeManagedProvider(null), false);
});

test("builds free models with models.dev official metadata", () => {
  const def = getFreeProvider("opencode-zen-free");
  assert.ok(def);
  const catalog = [
    {
      key: "opencode/deepseek-v4-flash-free",
      providerId: "opencode",
      providerName: "OpenCode Zen",
      providerBaseUrl: "https://opencode.ai/zen/v1",
      id: "deepseek-v4-flash-free",
      name: "DeepSeek V4 Flash Free",
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: "max",
        max: "max",
      },
      input: ["text"],
      contextWindow: 200_000,
      maxTokens: 128_000,
      cost: { input: 0, output: 0, cacheRead: 0 },
    },
    {
      key: "other/deepseek-v4-flash-free",
      providerId: "other",
      providerName: "Other",
      id: "deepseek-v4-flash-free",
      name: "Wrong Provider Copy",
      reasoning: false,
      contextWindow: 8_000,
      maxTokens: 1_000,
      cost: { input: 1, output: 2 },
    },
  ];
  const models = buildFreeModelEntries(def, ["deepseek-v4-flash-free", "unknown-free"], catalog);
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], {
    id: "deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash Free",
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
      max: "max",
    },
    thinkingMapLocked: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 128_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
  assert.equal(models[1].id, "unknown-free");
  assert.equal(models[1].name, "unknown-free");
  assert.equal(models[1].reasoning, undefined);
  assert.equal(models[1].contextWindow, undefined);
});

test("merge preserves disabled and overwrites official fields", () => {
  const merged = mergeFreeModelEntries(
    [
      { id: "deepseek-v4-flash-free", name: "old", disabled: true, contextWindow: 1 },
      { id: "gone-free", disabled: true },
    ],
    [
      {
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        reasoning: true,
        contextWindow: 200_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].disabled, true);
  assert.equal(merged[0].name, "DeepSeek V4 Flash Free");
  assert.equal(merged[0].contextWindow, 200_000);
  assert.equal(merged[0].reasoning, true);
});
test("preserves prior metadata when catalog entry is partial", () => {
  const merged = mergeFreeModelEntries(
    [{
      id: "partial-free",
      name: "Partial Free",
      disabled: true,
      reasoning: true,
      input: ["text"],
      contextWindow: 200_000,
      maxTokens: 128_000,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      thinkingLevelMap: { high: "high" },
      thinkingMapLocked: true,
    }],
    [{ id: "partial-free", name: "partial-free" }],
  );
  assert.deepEqual(merged[0], {
    id: "partial-free",
    name: "Partial Free",
    disabled: true,
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 128_000,
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    thinkingLevelMap: { high: "high" },
  });
});
