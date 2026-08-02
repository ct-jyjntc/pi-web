import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("getAgentDir defaults to ~/.pi/agent", async () => {
  const prev = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    const { getAgentDir } = await jiti.import("./agent-dir.ts");
    assert.equal(getAgentDir(), join(homedir(), ".pi", "agent"));
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
});

test("getAgentDir honors PI_CODING_AGENT_DIR with tilde", async () => {
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = "~/custom-agent";
  try {
    const { getAgentDir } = await jiti.import("./agent-dir.ts");
    assert.equal(getAgentDir(), join(homedir(), "custom-agent"));
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
});
