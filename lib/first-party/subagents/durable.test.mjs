import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isSubagentDescriptor } = await jiti.import("./durable.ts");

test("accepts a v1 continuable descriptor", () => {
  assert.equal(isSubagentDescriptor({
    version: 1,
    mode: "continuable",
    agentId: "a",
    type: "Explore",
    label: "Scout",
    depth: 1,
  }), true);
});

test("rejects malformed descriptors", () => {
  assert.equal(isSubagentDescriptor(null), false);
  assert.equal(isSubagentDescriptor({ version: 2, mode: "continuable" }), false);
  assert.equal(isSubagentDescriptor({ version: 1, mode: "maybe" }), false);
});
