import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
/** @type {typeof import("./agent-mode.ts")} */
let agentMode;
/** @type {typeof import("./agent-mode-brief.ts")} */
let brief;

before(async () => {
  agentMode = await jiti.import("./agent-mode.ts");
  brief = await jiti.import("./agent-mode-brief.ts");
});

describe("agent-mode", () => {
  it("only yolo flips the global ask→allow rewrite", () => {
    assert.equal(agentMode.agentModeWantsYolo("yolo"), true);
    for (const mode of ["ask", "auto", "plan"]) {
      assert.equal(agentMode.agentModeWantsYolo(mode), false, `${mode} must not enable yoloMode`);
    }
  });

  it("auto auto-approves edits without touching bash or outside-cwd access", () => {
    const overlay = agentMode.agentModePermissionOverlay("auto");
    assert.deepEqual(overlay, { edit: "allow", write: "allow" });
    // The whole point of the mode: these stay on the user's policy.
    assert.equal(overlay.bash, undefined);
    assert.equal(overlay.external_directory, undefined);
    assert.equal(overlay.path, undefined);
  });

  it("auto and yolo are not the same mode", () => {
    assert.notDeepEqual(
      {
        yolo: agentMode.agentModeWantsYolo("auto"),
        overlay: agentMode.agentModePermissionOverlay("auto"),
      },
      {
        yolo: agentMode.agentModeWantsYolo("yolo"),
        overlay: agentMode.agentModePermissionOverlay("yolo"),
      },
    );
  });

  it("plan overlay is empty; strip owns write tools", () => {
    assert.equal(agentMode.agentModeStripsWriteTools("plan"), true);
    assert.deepEqual(agentMode.agentModePermissionOverlay("plan"), {});
  });

  it("ask leaves the user's policy untouched", () => {
    assert.deepEqual(agentMode.agentModePermissionOverlay("ask"), {});
    assert.equal(agentMode.agentModeStripsWriteTools("ask"), false);
  });

  it("only plan carries a model brief", () => {
    assert.match(brief.agentModeBrief("plan") ?? "", /PLAN mode/);
    for (const mode of ["ask", "auto", "yolo"]) {
      assert.equal(brief.agentModeBrief(mode), null);
    }
  });

  it("parseAgentMode falls back to ask", () => {
    assert.equal(agentMode.parseAgentMode("nonsense"), "ask");
    assert.equal(agentMode.parseAgentMode(undefined), "ask");
    for (const mode of agentMode.AGENT_MODES) {
      assert.equal(agentMode.parseAgentMode(mode), mode);
    }
  });
});
