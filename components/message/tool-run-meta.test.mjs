import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { groupRunBlocks } = await jiti.import("./tool-run-meta.ts");

test("groups non-card presentations and splits on diff/ask/hoist", () => {
  const items = [
    { block: { type: "toolCall", toolCallId: "1", toolName: "read", input: {}, presentation: { card: "read", title: "a" } }, originalIndex: 0 },
    { block: { type: "toolCall", toolCallId: "2", toolName: "bash", input: {}, presentation: { card: "terminal", title: "ls" } }, originalIndex: 1 },
    { block: { type: "toolCall", toolCallId: "3", toolName: "edit", input: {}, presentation: { card: "diff", title: "a" } }, originalIndex: 2 },
    { block: { type: "toolCall", toolCallId: "4", toolName: "todo", input: {}, presentation: { card: "generic", title: "todo", hoist: true } }, originalIndex: 3 },
    { block: { type: "toolCall", toolCallId: "5", toolName: "grep", input: {}, presentation: { card: "search", title: "x" } }, originalIndex: 4 },
  ];
  const out = groupRunBlocks(items);
  assert.equal(out[0].kind, "run");
  assert.equal(out[0].items.length, 2);
  assert.equal(out[1].kind, "block");
  assert.equal(out[2].kind, "run");
  assert.equal(out[2].items.length, 1);
});

test("without presentation, a former card name is generic/run", () => {
  const items = [
    { block: { type: "toolCall", toolCallId: "1", toolName: "edit", input: {} }, originalIndex: 0 },
  ];
  const out = groupRunBlocks(items);
  assert.equal(out[0].kind, "run");
});
