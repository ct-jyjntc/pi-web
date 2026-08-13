import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { streamReducer, INITIAL_STREAMING_STATE } = await jiti.import("./agent-session-stream-state.ts");

test("applies text deltas then end snapshot content", () => {
  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  state = streamReducer(state, { type: "delta", event: { type: "text_start", contentIndex: 0 } });
  state = streamReducer(state, { type: "delta", event: { type: "text_delta", contentIndex: 0, delta: "Hel" } });
  state = streamReducer(state, { type: "delta", event: { type: "text_delta", contentIndex: 0, delta: "lo" } });
  assert.equal(state.streamingMessage.content[0].text, "Hello");
  state = streamReducer(state, { type: "end" });
  assert.equal(state.isStreaming, false);
  assert.equal(state.streamingMessage, null);
});

test("streams toolcall start/delta/end", () => {
  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  state = streamReducer(state, {
    type: "delta",
    event: { type: "toolcall_start", contentIndex: 0, id: "t1", toolName: "read" },
  });
  assert.equal(state.streamingMessage.content[0].toolName, "read");
  state = streamReducer(state, {
    type: "delta",
    event: { type: "toolcall_delta", contentIndex: 0, delta: "{\"path\":" },
  });
  state = streamReducer(state, {
    type: "delta",
    event: { type: "toolcall_delta", contentIndex: 0, delta: "\"a.ts\"}" },
  });
  assert.equal(state.streamingMessage.content[0].input.path, "a.ts");
  state = streamReducer(state, {
    type: "delta",
    event: { type: "toolcall_end", contentIndex: 0, toolCall: { id: "t1", name: "read", arguments: { path: "a.ts" } } },
  });
  assert.equal(state.streamingMessage.content[0].toolCallId, "t1");
  assert.equal(state.streamingMessage.content[0].input.__raw, undefined);
});
