import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

function usage(sessionId) {
  return {
    sessionId,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

test("applySessionProjections skips unmounted hook and mismatched session", async () => {
  const { applySessionProjections, canApplySessionProjections } = await jiti.import("./agent-session-live-apply.ts");
  const store = await jiti.import("./session-metrics-store.ts");
  store.setSessionStatsMetric(usage("keep"));

  assert.equal(canApplySessionProjections(false, "a", "a"), false);
  assert.equal(canApplySessionProjections(true, "child", "parent"), false);
  assert.equal(canApplySessionProjections(true, "a", "a"), true);

  applySessionProjections(
    { todos: null, title: null, tokenUsage: usage("stale"), contextPressure: null },
    false,
    "a",
    "a",
  );
  assert.equal(store.getSessionStatsMetric()?.sessionId, "keep");

  applySessionProjections(
    { todos: null, title: null, tokenUsage: usage("stale"), contextPressure: null },
    true,
    "child",
    "parent",
  );
  assert.equal(store.getSessionStatsMetric()?.sessionId, "keep");

  applySessionProjections(
    { todos: null, title: null, tokenUsage: usage("ok"), contextPressure: null },
    true,
    "ok",
    "ok",
  );
  assert.equal(store.getSessionStatsMetric()?.sessionId, "ok");
});
