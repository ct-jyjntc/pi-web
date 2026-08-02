/** Regression coverage for built-in provider metadata ownership and editability. */
import assert from "node:assert/strict";
import test from "node:test";

const { projectBuiltinProviderModel } = await (async () => {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./builtin-provider-models.ts");
})();

test("marks missing built-in metadata as editable", () => {
  const row = projectBuiltinProviderModel("__pi_web_test_provider__", {
    id: "__pi_web_unknown_model__",
    name: "Unknown model",
  }, false);

  assert.equal(row.reasoning, false);
  assert.equal(row.reasoningEditable, true);
  assert.equal(row.contextWindow, undefined);
  assert.equal(row.contextWindowEditable, true);
  assert.equal(row.maxTokens, undefined);
  assert.equal(row.maxTokensEditable, true);
  assert.equal(row.thinkingMapEditable, true);
});

test("marks official built-in metadata as read-only", () => {
  const row = projectBuiltinProviderModel("__pi_web_test_provider__", {
    id: "__pi_web_official_model__",
    name: "Official model",
    reasoning: true,
    contextWindow: 128000,
    maxTokens: 16384,
    thinkingLevelMap: { low: "low", high: "high" },
  }, true);

  assert.equal(row.reasoning, true);
  assert.equal(row.reasoningEditable, false);
  assert.equal(row.contextWindow, 128000);
  assert.equal(row.contextWindowEditable, false);
  assert.equal(row.maxTokens, 16384);
  assert.equal(row.maxTokensEditable, false);
  assert.equal(row.thinkingMapEditable, false);
  assert.equal(row.disabled, true);
});
