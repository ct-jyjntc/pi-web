import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before, beforeEach, after } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./permission-policy.ts")} */
let mod;
let agentDir;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

/** The document the extension actually enforces. */
function readEnforced() {
  return JSON.parse(readFileSync(mod.getPermissionPolicyPath(), "utf8"));
}

before(async () => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-web-permission-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mod = await jiti.import("./permission-policy.ts");
});

beforeEach(() => {
  rmSync(join(agentDir, "extensions"), { recursive: true, force: true });
  rmSync(join(agentDir, "pi-permissions.jsonc"), { force: true });
});

after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

describe("permission-policy base/effective split", () => {
  it("auto allows edits but leaves bash and outside-cwd access asking", () => {
    mod.writePermissionPolicy(mod.defaultPermissionPolicy(), "auto");
    const enforced = readEnforced();

    assert.equal(enforced.permission.edit, "allow");
    assert.equal(enforced.permission.write, "allow");
    // The distinction from yolo: these are untouched.
    assert.equal(enforced.yoloMode, false);
    assert.equal(enforced.permission.external_directory, "ask");
    assert.equal(enforced.permission.bash["*"], "ask");
    assert.equal(enforced.permission.path["*.env"], "deny");
  });

  it("yolo sets yoloMode instead of per-surface allows", () => {
    mod.writePermissionPolicy(mod.defaultPermissionPolicy(), "yolo");
    const enforced = readEnforced();

    assert.equal(enforced.yoloMode, true);
    assert.equal(enforced.permission.edit, undefined);
    assert.equal(enforced.permission.bash["*"], "ask");
  });

  it("plan overlay does not write edit/write deny", () => {
    mod.writePermissionPolicy(mod.defaultPermissionPolicy(), "plan");
    const enforced = readEnforced();
    // strip owns plan mutations; overlay must not add deny
    assert.notEqual(enforced.permission?.edit, "deny");
    assert.notEqual(enforced.permission?.write, "deny");
    assert.equal(enforced.yoloMode, false);
  });

  it("round-trips through auto without losing the user's own rules", () => {
    const authored = {
      ...mod.defaultPermissionPolicy(),
      permission: {
        "*": "ask",
        edit: "deny",
        bash: { "*": "deny" },
        read: "allow",
      },
    };
    mod.writePermissionPolicy(authored, "ask");
    assert.equal(readEnforced().permission.edit, "deny");

    mod.applyAgentModeToPermissionPolicy("auto");
    assert.equal(readEnforced().permission.edit, "allow", "auto overlays the authored rule");

    mod.applyAgentModeToPermissionPolicy("ask");
    assert.equal(
      readEnforced().permission.edit,
      "deny",
      "leaving auto restores the authored rule rather than dropping it",
    );
    assert.deepEqual(readEnforced().permission.bash, { "*": "deny" });
  });

  it("readPermissionPolicy reports the authored policy, not the overlay", () => {
    mod.writePermissionPolicy(
      { ...mod.defaultPermissionPolicy(), permission: { "*": "ask", edit: "deny" } },
      "auto",
    );
    // The settings editor must never see (and then re-save) a derived value.
    assert.equal(mod.readPermissionPolicy().policy.permission.edit, "deny");
    assert.equal(readEnforced().permission.edit, "allow");
  });

  it("adopts a pre-split config.json as the base policy", () => {
    const configPath = mod.getPermissionPolicyPath();
    mkdirSync(join(configPath, ".."), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ yoloMode: false, permission: { "*": "ask", bash: { "*": "deny" } } }),
      "utf8",
    );

    const ensured = mod.ensurePermissionPolicyFile();
    assert.deepEqual(ensured.policy.permission.bash, { "*": "deny" });

    mod.applyAgentModeToPermissionPolicy("auto");
    assert.equal(readEnforced().permission.edit, "allow");
    assert.deepEqual(readEnforced().permission.bash, { "*": "deny" }, "pre-split rules survive");
  });

  it("tracks the mode the enforced document was composed for", () => {
    mod.applyAgentModeToPermissionPolicy("plan");
    assert.equal(mod.readPolicyAgentMode(), "plan");
    mod.applyAgentModeToPermissionPolicy("yolo");
    assert.equal(mod.readPolicyAgentMode(), "yolo");
  });
});

describe("permission-policy mode reconcile", () => {
  it("drops the pre-split yoloMode an upgraded auto user was left with", () => {
    // What the old layout wrote for "auto": full yolo, no sidecar base.
    const configPath = mod.getPermissionPolicyPath();
    mkdirSync(join(configPath, ".."), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ yoloMode: true, permission: { "*": "ask", bash: { "*": "ask" } } }),
      "utf8",
    );

    assert.equal(mod.reconcilePermissionPolicyMode("auto"), true);
    const enforced = readEnforced();
    assert.equal(enforced.yoloMode, false, "auto must no longer imply yolo");
    assert.equal(enforced.permission.edit, "allow");
    assert.deepEqual(enforced.permission.bash, { "*": "ask" }, "shell keeps asking");
  });

  it("is a no-op once the config already matches the mode", () => {
    mod.applyAgentModeToPermissionPolicy("auto");
    assert.equal(mod.reconcilePermissionPolicyMode("auto"), false);
    assert.equal(mod.reconcilePermissionPolicyMode("plan"), true);
  });

  it("does not create policy state on a fresh install", () => {
    assert.equal(mod.reconcilePermissionPolicyMode("ask"), false);
    assert.equal(existsSync(mod.getPermissionPolicyPath()), false);
  });
});
