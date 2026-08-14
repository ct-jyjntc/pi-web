import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");

test("lifts toolcall id/name off partial before stripping the snapshot", () => {
  const client = toClientAgentEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          { type: "toolCall", id: "call_9", name: "grep", arguments: {} },
        ],
      },
    },
  });
  assert.ok(client);
  const delta = client.assistantMessageEvent;
  assert.equal(delta.type, "toolcall_start");
  assert.equal(delta.id, "call_9");
  assert.equal(delta.toolName, "grep");
  assert.equal(delta.partial, undefined);
});

test("toolcall_end includes presentation from presentCall", () => {
  const client = toClientAgentEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { type: "toolCall", id: "c1", name: "bash", arguments: { command: "pwd" } },
    },
  });
  const delta = client.assistantMessageEvent;
  assert.equal(delta.presentation.card, "terminal");
  assert.equal(delta.presentation.command, "pwd");
});

test("toolcall_start includes presentation even with empty args", () => {
  const client = toClientAgentEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      id: "c1",
      toolName: "read",
    },
  });
  assert.equal(client.assistantMessageEvent.presentation.card, "read");
});

test("message_end toolResult attaches presentResult on the host", () => {
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
  assert.equal(client.message.presentation.card, "diff");
  assert.equal(client.message.presentation.patch, "@@");
});
