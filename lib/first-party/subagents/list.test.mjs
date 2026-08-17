import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") },
});

/** @type {typeof import("./list.ts")} */
const { formatAgentList, listStatus, projectContinuable, buildCatalogRecords } = await jiti.import("./list.ts");

describe("list_agents projection", () => {
  it("maps running and queued to running", () => {
    assert.equal(listStatus({ status: "running" }, false), "running");
    assert.equal(listStatus({ status: "queued" }, false), "running");
  });

  it("maps a resident idle child to idle and a stored child to ready", () => {
    assert.equal(listStatus({ status: "completed" }, true), "idle");
    assert.equal(listStatus({ status: "completed" }, false), "ready");
  });

  it("omits one-shot children from the model list", () => {
    assert.equal(projectContinuable({
      id: "1",
      type: "Explore",
      displayName: "Explore",
      description: "Scout",
      status: "completed",
      startedAt: 1,
      mode: "one-shot",
    }, false), null);
  });

  it("formats DSH-shaped rows", () => {
    assert.equal(formatAgentList([], "children"), "(no subagents)");
    assert.equal(
      formatAgentList([{
        kind: "child",
        id: "sid-1",
        agentId: "a1",
        label: "Scout files",
        status: "ready",
        parent: "parent",
        depth: 2,
      }], "descendants"),
      "sid-1 [ready] parent=parent depth=2 — Scout files",
    );
  });
});

/** Duck-typed manager: buildCatalogRecords only reads list/isResident/get/currentTurnStartMs. */
function fakeManager(records, currentTurnStartMs) {
  return {
    currentTurnStartMs,
    list: () => records,
    isResident: () => false,
    get: (id) => records.find((r) => r.id === id || r.sessionId === id),
  };
}

describe("buildCatalogRecords latest-turn scoping", () => {
  const oldTurn = { id: "old", sessionId: "sid-old", description: "old scout", displayName: "Explore", type: "Explore", status: "completed", startedAt: 1000, mode: "continuable", parentTurnStartedAt: 1000 };
  const newTurn = { id: "new", sessionId: "sid-new", description: "new scout", displayName: "Explore", type: "Explore", status: "completed", startedAt: 2100, mode: "continuable", parentTurnStartedAt: 2000 };

  it("keeps only subagents from the latest turn", () => {
    const records = buildCatalogRecords(fakeManager([oldTurn, newTurn], 2000), "parent");
    assert.equal(records.length, 1);
    assert.equal(records[0].sessionId, "sid-new");
  });

  it("clears the capsule when the latest turn has no subagents yet", () => {
    const records = buildCatalogRecords(fakeManager([oldTurn, newTurn], 3000), "parent");
    assert.equal(records.length, 0);
  });

  it("shows the last persisted batch on reload (no active turn)", () => {
    const records = buildCatalogRecords(fakeManager([oldTurn, newTurn], 0), "parent");
    assert.equal(records.length, 1);
    assert.equal(records[0].sessionId, "sid-new");
  });
});
