import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") },
});

/** @type {typeof import("./list.ts")} */
const { formatAgentList, listStatus, projectContinuable } = await jiti.import("./list.ts");

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
