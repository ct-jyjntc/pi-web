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

  it("treats an aborted parent as aborted even when nothing is live", async () => {
    const manager = new NativeSubagentManager();
    const signal = AbortSignal.abort();
    // Avoid injecting follow-ups after Stop just because children already finished.
    assert.equal(await manager.waitUncollectedInEpoch(0, signal), "aborted");
  });

  it("wait() throws for an unknown id", async () => {
    const manager = new NativeSubagentManager();
    await assert.rejects(() => manager.wait("missing"), /not found/);
  });

  it("abort() returns false for an unknown id", async () => {
    const manager = new NativeSubagentManager();
    assert.equal(await manager.abort("missing"), false);
  });

  it("followup() throws for an unknown id", async () => {
    const manager = new NativeSubagentManager();
    await assert.rejects(() => manager.followup("missing", "more"), /not found/);
  });

  it("deliver() throws for an unknown id and does not wait on a missing child", async () => {
    const manager = new NativeSubagentManager();
    await assert.rejects(() => manager.deliver("missing", "more"), /not found/);
  });

  it("interrupt() reports a missing id", async () => {
    const manager = new NativeSubagentManager();
    assert.match(await manager.interrupt("missing"), /not found/);
  });
});
