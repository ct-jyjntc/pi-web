import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") },
});

/** @type {typeof import("./settle.ts")} */
const settle = await jiti.import("./settle.ts");

function record(overrides = {}) {
  return {
    id: "agent-1",
    type: "Explore",
    displayName: "Explore",
    description: "Scout files",
    status: "completed",
    result: "found z-index 1200 vs 1000",
    startedAt: 1,
    ...overrides,
  };
}

function fakeManager(initial = {}) {
  const state = {
    epoch: 1,
    records: /** @type {Map<string, any>} */ (new Map()),
    ...initial,
  };
  return {
    get epoch() {
      return state.epoch;
    },
    uncollectedInEpoch(epoch) {
      return [...state.records.values()].filter((item) => item.epoch === epoch && !item.collected);
    },
    async waitUncollectedInEpoch(epoch, signal) {
      if (typeof state.wait === "function") return state.wait(epoch, signal);
      return "ok";
    },
    markCollected(id) {
      const item = state.records.get(id);
      if (item) item.collected = true;
    },
    state,
  };
}

describe("shouldDeliverOnAgentEnd", () => {
  it("skips aborted, error, and length stops", () => {
    assert.equal(settle.shouldDeliverOnAgentEnd([{ role: "assistant", stopReason: "aborted" }]), false);
    assert.equal(settle.shouldDeliverOnAgentEnd([{ role: "assistant", stopReason: "error" }]), false);
    assert.equal(settle.shouldDeliverOnAgentEnd([{ role: "assistant", stopReason: "length" }]), false);
  });

  it("delivers after a clean stop", () => {
    assert.equal(settle.shouldDeliverOnAgentEnd([{ role: "assistant", stopReason: "stop" }]), true);
  });
});

describe("deliverUncollectedOnAgentEnd", () => {
  it("returns null when there is nothing to collect", async () => {
    const manager = fakeManager();
    const text = await settle.deliverUncollectedOnAgentEnd({
      manager,
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
    assert.equal(text, null);
  });

  it("waits, injects, and marks collected", async () => {
    const manager = fakeManager();
    manager.state.records.set("agent-1", { ...record(), epoch: 1, collected: false });
    const text = await settle.deliverUncollectedOnAgentEnd({
      manager,
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
    assert.match(text ?? "", /found z-index 1200 vs 1000/);
    assert.match(text ?? "", /Incorporate this result/);
    assert.equal(manager.state.records.get("agent-1").collected, true);
  });

  it("does not inject when wait is aborted", async () => {
    const manager = fakeManager({
      wait: async () => "aborted",
    });
    manager.state.records.set("agent-1", { ...record({ status: "running", result: undefined }), epoch: 1, collected: false });
    const text = await settle.deliverUncollectedOnAgentEnd({
      manager,
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
    assert.equal(text, null);
    assert.equal(manager.state.records.get("agent-1").collected, false);
  });

  it("ignores uncollected records from another prompt epoch", async () => {
    const manager = fakeManager();
    manager.state.records.set("old", { ...record({ id: "old" }), epoch: 0, collected: false });
    const text = await settle.deliverUncollectedOnAgentEnd({
      manager,
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
    assert.equal(text, null);
    assert.equal(manager.state.records.get("old").collected, false);
  });
});
