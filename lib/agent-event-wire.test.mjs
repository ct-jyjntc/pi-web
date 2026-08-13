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
