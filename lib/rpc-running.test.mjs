import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("getRunningRpcSessionIds is empty when registry is missing", async () => {
  const prev = globalThis.__piSessions;
  globalThis.__piSessions = undefined;
  try {
    const { getRunningRpcSessionIds } = await jiti.import("./rpc-running.ts");
    assert.deepEqual(getRunningRpcSessionIds(), []);
  } finally {
    globalThis.__piSessions = prev;
  }
});

test("getRunningRpcSessionIds returns only running wrappers", async () => {
  const prev = globalThis.__piSessions;
  globalThis.__piSessions = new Map([
    ["a", { sessionId: "a", isRunning: () => true }],
    ["b", { sessionId: "b", isRunning: () => false }],
    ["c", { sessionId: "real-c", isRunning: () => true }],
  ]);
  try {
    const { getRunningRpcSessionIds } = await jiti.import("./rpc-running.ts");
    assert.deepEqual(getRunningRpcSessionIds().sort(), ["a", "real-c"]);
  } finally {
    globalThis.__piSessions = prev;
  }
});
