import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  unmatchedToolCallsOnTrailingAssistant,
  applyRepairToMessages,
  shouldRepairOnOpen,
  buildInterruptedToolResult,
  INTERRUPTED_TOOL_RESULT_TEXT,
} = await jiti.import("./session-tool-repair.ts");

function assistantWithCalls(ids, stopReason) {
  return {
    role: "assistant",
    model: "m",
    provider: "p",
    stopReason,
    content: ids.map((id) => ({ type: "toolCall", toolCallId: id, toolName: "bash", input: {} })),
  };
}

function sdkAssistantWithCalls(calls, stopReason) {
  return {
    role: "assistant",
    model: "m",
    provider: "p",
    stopReason,
    content: calls.map(({ id, name }) => ({ type: "toolCall", id, name, arguments: {} })),
  };
}

test("trailing completed assistant missing results → N", () => {
  const calls = unmatchedToolCallsOnTrailingAssistant([assistantWithCalls(["a", "b"])]);
  assert.deepEqual(calls.map((c) => c.toolCallId), ["a", "b"]);
});

test("already paired → 0", () => {
  const msgs = [
    assistantWithCalls(["a"]),
    { role: "toolResult", toolCallId: "a", toolName: "bash", content: [{ type: "text", text: "ok" }] },
  ];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("second scan after apply → 0", () => {
  const msgs = [assistantWithCalls(["a"])];
  const { nextMessages } = applyRepairToMessages(msgs);
  assert.equal(unmatchedToolCallsOnTrailingAssistant(nextMessages).length, 0);
  assert.equal(nextMessages.at(-1).content[0].text, INTERRUPTED_TOOL_RESULT_TEXT);
  assert.equal(nextMessages.at(-1).isError, true);
});

test("aborted last assistant → 0", () => {
  assert.equal(unmatchedToolCallsOnTrailingAssistant([assistantWithCalls(["a"], "aborted")]).length, 0);
  assert.equal(unmatchedToolCallsOnTrailingAssistant([assistantWithCalls(["a"], "error")]).length, 0);
});

test("later user → 0", () => {
  const msgs = [assistantWithCalls(["a"]), { role: "user", content: "go on" }];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("later bashExecution → 0", () => {
  const msgs = [assistantWithCalls(["a"]), { role: "bashExecution", command: "ls", output: "" }];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("shouldRepairOnOpen skips live wrapper", () => {
  assert.equal(shouldRepairOnOpen({ alive: true }), false);
  assert.equal(shouldRepairOnOpen({ alive: false }), true);
});

test("SDK-shaped toolCall { id, name } pairs after normalizeToolCalls", () => {
  const calls = unmatchedToolCallsOnTrailingAssistant([
    sdkAssistantWithCalls([{ id: "sdk-1", name: "read" }, { id: "sdk-2", name: "edit" }]),
  ]);
  assert.deepEqual(calls, [
    { toolCallId: "sdk-1", toolName: "read" },
    { toolCallId: "sdk-2", toolName: "edit" },
  ]);
});

test("SDK-shaped already paired → 0", () => {
  const msgs = [
    sdkAssistantWithCalls([{ id: "sdk-1", name: "read" }]),
    { role: "toolResult", toolCallId: "sdk-1", toolName: "read", content: [{ type: "text", text: "ok" }] },
  ];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(msgs).length, 0);
});

test("partial trailing results close only unmatched ids", () => {
  const msgs = [
    assistantWithCalls(["a", "b"]),
    { role: "toolResult", toolCallId: "a", toolName: "bash", content: [{ type: "text", text: "ok" }] },
  ];
  assert.deepEqual(unmatchedToolCallsOnTrailingAssistant(msgs), [{ toolCallId: "b", toolName: "bash" }]);
});

test("later custom or later assistant → 0", () => {
  const custom = [assistantWithCalls(["a"]), { role: "custom", customType: "x", content: "n", display: true }];
  const nextAsst = [assistantWithCalls(["a"]), assistantWithCalls(["b"])];
  assert.equal(unmatchedToolCallsOnTrailingAssistant(custom).length, 0);
  assert.deepEqual(unmatchedToolCallsOnTrailingAssistant(nextAsst).map((c) => c.toolCallId), ["b"]);
});

test("applyRepairToMessages persist + nextMessages; no-op returns same array", () => {
  const dangling = [assistantWithCalls(["a"])];
  const { persist, nextMessages } = applyRepairToMessages(dangling);
  assert.equal(persist.length, 1);
  assert.equal(persist[0].role, "toolResult");
  assert.equal(persist[0].toolCallId, "a");
  assert.equal(persist[0].toolName, "bash");
  assert.equal(persist[0].isError, true);
  assert.equal(persist[0].content[0].type, "text");
  assert.equal(persist[0].content[0].text, INTERRUPTED_TOOL_RESULT_TEXT);
  assert.equal(typeof persist[0].timestamp, "number");
  assert.equal(nextMessages.length, dangling.length + 1);
  assert.equal(nextMessages.at(-1), persist[0]);

  const balanced = [
    assistantWithCalls(["a"]),
    { role: "toolResult", toolCallId: "a", toolName: "bash", content: [{ type: "text", text: "ok" }] },
  ];
  const noop = applyRepairToMessages(balanced);
  assert.equal(noop.persist.length, 0);
  assert.equal(noop.nextMessages, balanced);
});

test("buildInterruptedToolResult shape", () => {
  const closer = buildInterruptedToolResult("id-1", "read");
  assert.deepEqual(
    {
      role: closer.role,
      toolCallId: closer.toolCallId,
      toolName: closer.toolName,
      isError: closer.isError,
      content: closer.content,
    },
    {
      role: "toolResult",
      toolCallId: "id-1",
      toolName: "read",
      isError: true,
      content: [{ type: "text", text: INTERRUPTED_TOOL_RESULT_TEXT }],
    },
  );
  assert.equal(typeof closer.timestamp, "number");
  assert.equal(INTERRUPTED_TOOL_RESULT_TEXT, "Tool did not finish (session interrupted).");
});

test("missing last assistant → 0", () => {
  assert.equal(unmatchedToolCallsOnTrailingAssistant([]).length, 0);
  assert.equal(
    unmatchedToolCallsOnTrailingAssistant([{ role: "user", content: "hi" }]).length,
    0,
  );
});
