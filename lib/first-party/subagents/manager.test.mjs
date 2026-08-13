import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") },
});

/** @type {typeof import("./manager.ts")} */
const { NativeSubagentManager } = await jiti.import("./manager.ts");

describe("NativeSubagentManager epoch settlement", () => {
  it("starts at epoch 0 and advances on beginPrompt", () => {
    const manager = new NativeSubagentManager();
    assert.equal(manager.epoch, 0);
    manager.beginPrompt();
    assert.equal(manager.epoch, 1);
  });

  it("treats an empty epoch as already settled", async () => {
    const manager = new NativeSubagentManager();
    manager.beginPrompt();
    assert.deepEqual(manager.uncollectedInEpoch(1), []);
    assert.equal(await manager.waitUncollectedInEpoch(1), "ok");
    manager.markCollected("missing");
  });

  it("does not abort-wait when nothing is live", async () => {
    const manager = new NativeSubagentManager();
    const signal = AbortSignal.abort();
    // No live records → still ok (nothing to wait for).
    assert.equal(await manager.waitUncollectedInEpoch(0, signal), "ok");
  });
});
