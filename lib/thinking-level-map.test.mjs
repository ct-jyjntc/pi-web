import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./thinking-level-map.ts");
  } catch {
    return import("./thinking-level-map.ts");
  }
}

const {
  mapEffortValuesToThinkingLevelMap,
  thinkingLevelMapFromReasoningOptions,
  availableThinkingLevelsFromMap,
  PI_THINKING_LEVELS,
} = await loadSubject();

test("maps high/max effort (deepseek free style)", () => {
  const map = mapEffortValuesToThinkingLevelMap(["high", "max"]);
  assert.equal(map.off, null);
  assert.equal(map.minimal, null);
  assert.equal(map.low, null);
  assert.equal(map.medium, null);
  assert.equal(map.high, "high");
  assert.equal(map.xhigh, "max");
  assert.equal(map.max, "max");
});

test("maps low/medium/high effort", () => {
  const map = mapEffortValuesToThinkingLevelMap(["low", "medium", "high"]);
  assert.equal(map.low, "low");
  assert.equal(map.medium, "medium");
  assert.equal(map.high, "high");
  assert.equal(map.xhigh, null);
  assert.equal(map.max, null);
});

test("maps none/high effort", () => {
  const map = mapEffortValuesToThinkingLevelMap(["none", "high"]);
  assert.equal(map.off, "none");
  assert.equal(map.high, "high");
  assert.equal(map.low, null);
});

test("toggle-only reasoning_options yields no map", () => {
  assert.equal(
    thinkingLevelMapFromReasoningOptions([{ type: "toggle" }]),
    undefined,
  );
});

test("parses effort option from reasoning_options", () => {
  const map = thinkingLevelMapFromReasoningOptions([
    { type: "toggle" },
    { type: "effort", values: ["low", "medium", "high"] },
  ]);
  assert.equal(map.low, "low");
  assert.equal(map.high, "high");
});

test("positional fallback for unknown effort labels", () => {
  const map = mapEffortValuesToThinkingLevelMap(["A", "B"]);
  assert.equal(map.xhigh, "A");
  assert.equal(map.max, "B");
  assert.equal(map.high, null);
});

test("available levels use map exclusively (no merge with fallback)", () => {
  const fallback = ["off", "minimal", "low", "medium", "high"];
  assert.deepEqual(
    availableThinkingLevelsFromMap(undefined, fallback),
    fallback,
  );
  assert.deepEqual(
    availableThinkingLevelsFromMap({}, fallback),
    fallback,
  );
  // Only explicitly configured non-null keys.
  assert.deepEqual(
    availableThinkingLevelsFromMap({ high: "high", max: "max" }, fallback),
    ["high", "max"],
  );
  assert.deepEqual(
    availableThinkingLevelsFromMap({ low: null, high: "high", max: "max" }, fallback),
    ["high", "max"],
  );
  assert.deepEqual(
    availableThinkingLevelsFromMap({
      off: "off",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    }, fallback),
    [...PI_THINKING_LEVELS],
  );
});
