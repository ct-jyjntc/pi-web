import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  childSessionIdFromTool,
  childSessionIdFromText,
} = await jiti.import("./identity.ts");

const SID = "01234567-89ab-4def-8123-456789abcdef";
const AGENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("prefers details.sessionId over Agent ID text", () => {
  const id = childSessionIdFromTool({
    toolName: "subagent",
    details: { agentId: AGENT, sessionId: SID },
    resultText: `Agent ID: ${AGENT}\nSession ID: ${SID}`,
  });
  assert.equal(id, SID);
});

test("parses Session ID line and ignores Agent started", () => {
  assert.equal(childSessionIdFromText(`Agent started: ${AGENT}\nSession ID: ${SID}`), SID);
  assert.equal(childSessionIdFromTool({
    toolName: "subagent",
    resultText: `Agent started: ${AGENT}`,
  }), null);
});

test("ignores unrelated tools", () => {
  assert.equal(childSessionIdFromTool({
    toolName: "bash",
    details: { sessionId: SID },
  }), null);
});
