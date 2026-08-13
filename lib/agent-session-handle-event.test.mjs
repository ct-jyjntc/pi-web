import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { handleAgentSessionEvent } = await jiti.import("./agent-session-handle-event.ts");

function makeCtx(overrides = {}) {
  const retry = { current: null };
  const ctx = {
    agentRunningRef: { current: true },
    sessionIdRef: { current: "s1" },
    promptRunIdRef: { current: 1 },
    streamAcceptRunIdRef: { current: 1 },
    optimisticUserMessageKeyRef: { current: null },
    sseReconnectAttemptRef: { current: 0 },
    sseReconnectTimerRef: { current: null },
    setAgentRunning() {},
    setAgentPhase() {},
    setRetryInfo(v) { retry.current = v; },
    setMessages() {},
    setQueuedMessages() {},
    setIsCompacting() {},
    setCompactError() {},
    setCompactResult() {},
    setContextUsage() {},
    dispatchStream() {},
    closeEvents() {},
    finishPromptWithoutStream: async () => {},
    loadSession: async () => null,
    waitForPromptSettlement: async () => {},
    handleExtensionUiRequest() {},
    addNotice() {},
    t: (key) => key,
    ...overrides,
  };
  return { ctx, retry };
}

test("auto_retry_start shows the retry banner", () => {
  const { ctx, retry } = makeCtx();
  handleAgentSessionEvent({
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    errorMessage: "429",
  }, ctx);
  assert.deepEqual(retry.current, { attempt: 1, maxAttempts: 3, errorMessage: "429" });
});

test("agent_start hides the retry banner once the retry request is in flight", () => {
  const { ctx, retry } = makeCtx();
  handleAgentSessionEvent({
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    errorMessage: "429",
  }, ctx);
  handleAgentSessionEvent({ type: "agent_start" }, ctx);
  assert.equal(retry.current, null);
});

test("auto_retry_end still clears a cancelled or exhausted retry", () => {
  const { ctx, retry } = makeCtx();
  handleAgentSessionEvent({
    type: "auto_retry_start",
    attempt: 2,
    maxAttempts: 3,
    errorMessage: "timeout",
  }, ctx);
  handleAgentSessionEvent({ type: "auto_retry_end", success: false, attempt: 2 }, ctx);
  assert.equal(retry.current, null);
});

test("connected keeps the stream bubble while the run is still live", () => {
  const actions = [];
  const { ctx } = makeCtx({
    dispatchStream(action) { actions.push(action.type); },
  });
  handleAgentSessionEvent({ type: "connected", isStreaming: true }, ctx);
  assert.deepEqual(actions, []);
});

test("connected clears a stale bubble when the session is idle", () => {
  const actions = [];
  const { ctx } = makeCtx({
    agentRunningRef: { current: false },
    dispatchStream(action) { actions.push(action.type); },
  });
  handleAgentSessionEvent({ type: "connected", isStreaming: false }, ctx);
  assert.deepEqual(actions, ["end"]);
});
