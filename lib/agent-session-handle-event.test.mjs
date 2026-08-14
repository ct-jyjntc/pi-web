import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { handleAgentSessionEvent } = await jiti.import("./agent-session-handle-event.ts");
const { toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");
const { normalizeToolCalls } = await jiti.import("./normalize.ts");
const { subscribeWorkspaceFilesChanged } = await jiti.import("@/lib/workspace-change-notify.ts");

function makeCtx(overrides = {}) {
  const retry = { current: null };
  const ctx = {
    agentRunningRef: { current: true },
    abortRequestedRef: { current: false },
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

test("agent_start does not resurrect a killed run", () => {
  let running = false;
  const { ctx } = makeCtx({
    abortRequestedRef: { current: true },
    agentRunningRef: { current: false },
    setAgentRunning(v) { running = v; },
  });
  handleAgentSessionEvent({ type: "agent_start" }, ctx);
  assert.equal(running, false);
  assert.equal(ctx.agentRunningRef.current, false);
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

test("write tool end notifies workspace files changed once", () => {
  const hits = [];
  const unsub = subscribeWorkspaceFilesChanged(() => hits.push(1));
  const { ctx } = makeCtx();
  handleAgentSessionEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "write" }, ctx);
  assert.equal(hits.length, 0);
  handleAgentSessionEvent({ type: "tool_execution_end", toolCallId: "t1" }, ctx);
  assert.equal(hits.length, 1);
  handleAgentSessionEvent({ type: "tool_execution_end", toolCallId: "t1" }, ctx);
  assert.equal(hits.length, 1);
  unsub();
});

test("edit tool end notifies workspace files changed", () => {
  const hits = [];
  const unsub = subscribeWorkspaceFilesChanged(() => hits.push(1));
  const { ctx } = makeCtx();
  handleAgentSessionEvent({ type: "tool_execution_start", toolCallId: "e1", toolName: "edit" }, ctx);
  handleAgentSessionEvent({ type: "tool_execution_end", toolCallId: "e1" }, ctx);
  assert.equal(hits.length, 1);
  unsub();
});

test("read tool end does not notify workspace files changed", () => {
  const hits = [];
  const unsub = subscribeWorkspaceFilesChanged(() => hits.push(1));
  const { ctx } = makeCtx();
  handleAgentSessionEvent({ type: "tool_execution_start", toolCallId: "r1", toolName: "read" }, ctx);
  handleAgentSessionEvent({ type: "tool_execution_end", toolCallId: "r1" }, ctx);
  assert.equal(hits.length, 0);
  unsub();
});

test("toolResult message_end copies presentation onto the committed toolCall", () => {
  let messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName: "write",
      input: { path: "a.ts" },
      presentation: { card: "generic", title: "a.ts" },
    }],
  }];
  const { ctx } = makeCtx({
    setMessages(updater) { messages = updater(messages); },
  });
  handleAgentSessionEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "write",
      content: [{ type: "text", text: "ok" }],
      details: { patch: "@@" },
      presentation: { card: "diff", title: "a.ts", patch: "@@" },
    },
  }, ctx);
  assert.equal(messages[0].content[0].presentation.card, "diff");
  assert.equal(messages[0].content[0].presentation.patch, "@@");
  assert.equal(messages[1].role, "toolResult");
});

test("toolResult message_end is ignored when the run is not live", () => {
  let messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName: "write",
      input: { path: "a.ts" },
      presentation: { card: "generic", title: "write" },
    }],
  }];
  const { ctx } = makeCtx({
    agentRunningRef: { current: false },
    setMessages(updater) { messages = updater(messages); },
  });
  handleAgentSessionEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "write",
      content: [{ type: "text", text: "ok" }],
      presentation: { card: "diff", title: "a.ts", patch: "@@" },
    },
  }, ctx);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content[0].presentation.card, "generic");
});

test("toolResult message_end is ignored when promptRunId does not match", () => {
  let messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName: "write",
      input: {},
      presentation: { card: "generic", title: "write" },
    }],
  }];
  const { ctx } = makeCtx({
    promptRunIdRef: { current: 2 },
    streamAcceptRunIdRef: { current: 1 },
    setMessages(updater) { messages = updater(messages); },
  });
  handleAgentSessionEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "write",
      content: [{ type: "text", text: "ok" }],
      presentation: { card: "diff", title: "a.ts", patch: "@@" },
    },
  }, ctx);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content[0].presentation.card, "generic");
});

test("normalizeToolCalls keeps presentation on toolCall blocks", () => {
  const out = normalizeToolCalls({
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      id: "c1",
      name: "bash",
      arguments: { command: "ls" },
      presentation: { card: "terminal", title: "ls", command: "ls" },
    }],
  });
  assert.equal(out.content[0].toolName, "bash");
  assert.equal(out.content[0].presentation.card, "terminal");
  assert.equal(out.content[0].presentation.command, "ls");
});

test("assistant message_end keeps presentCall after wire + handle-event", () => {
  const client = toClientAgentEvent({
    type: "message_end",
    message: {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{
        type: "toolCall",
        id: "c1",
        name: "bash",
        arguments: { command: "pwd" },
      }],
    },
  });
  let messages = [];
  const { ctx } = makeCtx({
    setMessages(updater) { messages = updater(messages); },
  });
  handleAgentSessionEvent(client, ctx);
  assert.equal(messages[0].content[0].toolName, "bash");
  assert.equal(messages[0].content[0].presentation.card, "terminal");
  assert.equal(messages[0].content[0].presentation.command, "pwd");
});

test("toolResult message_end merges patch without replacing presentCall title", () => {
  let messages = [{
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{
      type: "toolCall",
      toolCallId: "c1",
      toolName: "write",
      input: { path: "a.ts" },
      presentation: { card: "generic", title: "a.ts", locations: ["a.ts"] },
    }],
  }];
  const { ctx } = makeCtx({
    setMessages(updater) { messages = updater(messages); },
  });
  const client = toClientAgentEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "write",
      content: [{ type: "text", text: "ok" }],
      details: { patch: "@@" },
    },
  });
  handleAgentSessionEvent(client, ctx);
  assert.equal(messages[0].content[0].presentation.card, "diff");
  assert.equal(messages[0].content[0].presentation.patch, "@@");
  assert.equal(messages[0].content[0].presentation.title, "a.ts");
  assert.deepEqual(messages[0].content[0].presentation.locations, ["a.ts"]);
});

test("message_start snapshot keeps presentation through normalize", () => {
  const snapshots = [];
  const { ctx } = makeCtx({
    dispatchStream(action) { snapshots.push(action); },
  });
  handleAgentSessionEvent({
    type: "message_start",
    message: {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{
        type: "toolCall",
        id: "c1",
        name: "bash",
        arguments: { command: "ls" },
        presentation: { card: "terminal", title: "ls", command: "ls" },
      }],
    },
  }, ctx);
  assert.equal(snapshots[0].type, "snapshot");
  assert.equal(snapshots[0].message.content[0].presentation.card, "terminal");
  assert.equal(snapshots[0].message.content[0].toolName, "bash");
});
