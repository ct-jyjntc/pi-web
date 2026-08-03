import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./permission-policy-rows.ts")} */
let mod;

before(async () => {
  mod = await jiti.import("./permission-policy-rows.ts");
});

describe("permission-policy-rows", () => {
  it("round-trips string surfaces and pattern maps", () => {
    const permission = {
      "*": "ask",
      read: "allow",
      bash: {
        "*": "ask",
        "git status": "allow",
        "rm -rf *": { action: "deny", reason: "dangerous" },
      },
      path: {
        "*.env": "deny",
      },
    };
    const rows = mod.permissionToRows(permission);
    assert.ok(rows.some((r) => r.surface === "*" && r.pattern === "" && r.action === "ask"));
    assert.ok(rows.some((r) => r.surface === "bash" && r.pattern === "git status" && r.action === "allow"));
    assert.ok(rows.some((r) => r.surface === "bash" && r.pattern === "rm -rf *" && r.action === "deny" && r.reason === "dangerous"));

    const back = mod.rowsToPermission(rows);
    assert.equal(back["*"], "ask");
    assert.equal(back.read, "allow");
    assert.equal(back.bash["git status"], "allow");
    assert.deepEqual(back.bash["rm -rf *"], { action: "deny", reason: "dangerous" });
    assert.equal(back.path["*.env"], "deny");
  });

  it("collapses single empty-pattern surface to string", () => {
    const rows = [
      mod.emptyRuleRow({ surface: "read", pattern: "", action: "allow" }),
    ];
    const perm = mod.rowsToPermission(rows);
    assert.equal(perm.read, "allow");
  });

  it("last duplicate pattern wins", () => {
    const rows = [
      mod.emptyRuleRow({ surface: "bash", pattern: "npm *", action: "ask" }),
      mod.emptyRuleRow({ surface: "bash", pattern: "npm *", action: "deny" }),
    ];
    const perm = mod.rowsToPermission(rows);
    assert.equal(perm.bash["npm *"], "deny");
  });
});
