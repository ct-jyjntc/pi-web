import assert from "node:assert/strict";
import test from "node:test";

const { normalizeModelCost } = await import("./model-cost.ts");

test("normalizes complete and partial model costs to finite numbers", () => {
  assert.deepEqual(normalizeModelCost({ input: "1.25", output: 10 }), {
    input: 1.25,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("rejects non-numeric and non-string values consistently", () => {
  assert.deepEqual(normalizeModelCost({
    input: "  ",
    output: "12oops",
    cacheRead: true,
    cacheWrite: Number.POSITIVE_INFINITY,
  }), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});
