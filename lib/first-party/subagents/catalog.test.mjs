import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./catalog.ts")} */
let catalog;

before(async () => {
  catalog = await jiti.import("./catalog.ts");
});

describe("resolveAgentType", () => {
  it("maps scout-style unknown names to general-purpose", () => {
    const types = new Map(catalog.FALLBACK_AGENT_TYPES.map((type) => [type.name, type]));
    const resolved = catalog.resolveAgentType("scout", types);
    assert.equal(resolved.type.name, "general-purpose");
    assert.match(resolved.note ?? "", /Unknown agent type "scout"/);
  });

  it("matches Reviewer case-insensitively", () => {
    const types = new Map(catalog.FALLBACK_AGENT_TYPES.map((type) => [type.name, type]));
    const resolved = catalog.resolveAgentType("reviewer", types);
    assert.equal(resolved.type.name, "Reviewer");
    assert.equal(resolved.note, undefined);
  });
});
