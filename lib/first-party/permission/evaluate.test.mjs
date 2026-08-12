import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./evaluate.ts")} */
let evaluate;
/** @type {typeof import("../../permission-policy.ts")} */
let policy;

before(async () => {
  evaluate = await jiti.import("./evaluate.ts");
  policy = await jiti.import("../../permission-policy.ts");
});

describe("evaluatePermission", () => {
  it("allows git status and denies sudo from the default policy", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-perm-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    mkdirSync(join(dir, "extensions", "pi-permission-system"), { recursive: true });
    policy.writePermissionPolicy(policy.defaultPermissionPolicy(), "ask");

    const allow = evaluate.evaluatePermission({
      toolName: "bash",
      toolInput: { command: "git status" },
      cwd: dir,
      mode: "ask",
    });
    assert.equal(allow.action, "allow");

    const deny = evaluate.evaluatePermission({
      toolName: "bash",
      toolInput: { command: "sudo rm -rf /" },
      cwd: dir,
      mode: "ask",
    });
    assert.equal(deny.action, "deny");

    const ask = evaluate.evaluatePermission({
      toolName: "bash",
      toolInput: { command: "ls -la" },
      cwd: dir,
      mode: "ask",
    });
    assert.equal(ask.action, "ask");
  });

  it("denies a chained command when any segment is denied", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-perm-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    mkdirSync(join(dir, "extensions", "pi-permission-system"), { recursive: true });
    policy.writePermissionPolicy(policy.defaultPermissionPolicy(), "ask");

    const chained = evaluate.evaluatePermission({
      toolName: "bash",
      toolInput: { command: "echo hi && rm -rf /tmp/x" },
      cwd: dir,
      mode: "ask",
    });
    assert.equal(chained.action, "deny");
  });

  it("treats a sibling directory as outside cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-perm-"));
    assert.equal(evaluate.isOutsideCwd(dir, join(dir, "src", "a.ts")), false);
    assert.equal(evaluate.isOutsideCwd(dir, join(dir, "..", "other", "a.ts")), true);
    assert.equal(evaluate.isOutsideCwd(dir, join(dir, "..foo")), false);
  });
});
