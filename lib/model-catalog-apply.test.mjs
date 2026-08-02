import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-catalog-apply.ts");
  } catch {
    return import("./model-catalog-apply.ts");
  }
}

const {
  applyOfficialCatalogFields,
  isCatalogExactMatch,
} = await loadSubject();

const thinkingMap = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: "max",
  max: "max",
};

const preset = {
  name: "DeepSeek V4 Flash Free",
  reasoning: true,
  thinkingLevelMap: thinkingMap,
  input: ["text"],
  contextWindow: 200_000,
  maxTokens: 128_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

test("managed match requires provider or base-url ownership, not consensus", () => {
  assert.equal(isCatalogExactMatch({ exactMatches: 2, metadataMethod: "provider" }), true);
  assert.equal(isCatalogExactMatch({ exactMatches: 1, metadataMethod: "base-url" }), true);
  assert.equal(isCatalogExactMatch({ exactMatches: 3, metadataMethod: "consensus" }), false);
  assert.equal(isCatalogExactMatch({ exactMatches: 0, metadataMethod: "none" }), false);
  assert.equal(isCatalogExactMatch(null), false);
});

test("overwrites official fields from catalog preset", () => {
  const result = applyOfficialCatalogFields(
    {
      id: "deepseek-v4-flash-free",
      name: "old",
      reasoning: false,
      contextWindow: 1,
      cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
    },
    preset,
  );
  assert.equal(result.changed, true);
  assert.equal(result.model.name, "DeepSeek V4 Flash Free");
  assert.equal(result.model.reasoning, true);
  assert.deepEqual(result.model.thinkingLevelMap, thinkingMap);
  assert.equal(result.model.contextWindow, 200_000);
  assert.equal(result.model.maxTokens, 128_000);
  assert.deepEqual(result.model.input, ["text"]);
  assert.deepEqual(result.model.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("clears reasoning when catalog says no", () => {
  const result = applyOfficialCatalogFields(
    { reasoning: true, name: "X" },
    { name: "X", reasoning: false },
  );
  assert.equal(result.model.reasoning, undefined);
  assert.equal(result.changed, true);
});

test("no-op when already matching", () => {
  const model = {
    name: "DeepSeek V4 Flash Free",
    reasoning: true,
    thinkingLevelMap: thinkingMap,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 128_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const result = applyOfficialCatalogFields(model, preset);
  assert.equal(result.changed, false);
  assert.equal(result.appliedCount, 0);
});

test("does not clear reasoning when the catalog omits it", () => {
  const result = applyOfficialCatalogFields(
    { name: "X", reasoning: true },
    { name: "X" },
  );
  assert.equal(result.model.reasoning, true);
  assert.equal(result.changed, false);
});
