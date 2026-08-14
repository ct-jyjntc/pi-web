import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { resolveToolAdoption } = await jiti.import("./rpc-session-tool-adoption.ts");

test("omitted toolNames adopts the full coding list", () => {
  const r = resolveToolAdoption(undefined);
  assert.equal(r.kind, "adopt");
  assert.ok(r.names.includes("edit"));
  assert.ok(r.names.includes("bash"));
});

test("empty toolNames means all off", () => {
  assert.deepEqual(resolveToolAdoption([]), { kind: "all-off" });
});

test("explicit list is kept", () => {
  assert.deepEqual(resolveToolAdoption(["read"]), { kind: "adopt", names: ["read"] });
});
