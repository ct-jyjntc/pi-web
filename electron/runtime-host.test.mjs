import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { roleForPath } = require("./runtime-host.js");

test("light routes never touch the agent SDK graph", () => {
  const light = [
    "/api/home",
    "/api/sessions",
    "/api/web-settings?utilityModels=0",
    "/api/health",
    "/api/files/foo",
    "/api/git/status",
    "/api/accounts",
    "/api/accounts/github/connect",
    "/api/cwd/validate",
    "/api/worktrees",
    "/api/usage",
    "/api/app-update",
    "/api/permissions",
    "/api/mcp",
    "/api/lsp",
    "/api/models-config",
    "/api/models-config/free-models?provider=x",

    "/api/models-config/disabled-models",
    // Built-in catalogs default to disk cache (no ModelRuntime).
    "/api/models-config/provider-models?provider=openai",
    "/api/default-cwd",
    "/api/github?cwd=x",
    "/api/debug/sessions",
    "/api/skills/install",
    "/api/skills/search",
  ];
  for (const path of light) {
    assert.equal(roleForPath(path), "light", path);
  }
});

test("SDK / ModelRuntime routes stay on heavy", () => {
  const heavy = [
    "/api/models",
    // Live catalog refresh for one built-in provider.
    "/api/models-config/provider-models?provider=openai&fresh=1",
    "/api/models-config/model-overrides",
    "/api/models-config/test",
    "/api/models-config/discover",
    "/api/auth/providers",
    "/api/auth/all-providers",
    "/api/auth/login/openai",
    "/api/skills",
    "/api/skills/content",
    "/api/skills/check",
    "/api/skills/update",
    "/api/project-trust?cwd=x",
    "/api/project-memory?cwd=x",
    "/api/project-init",
    "/api/sessions/abc",
    "/api/sessions/abc/context",
    "/api/workspace-journal?sessionId=1",
    "/api/agent/new",
    "/api/agent/running",
    "/api/agent/abc",
    "/api/agent/abc/events",
    "/api/advisor",
    "/api/memory-review",
    "/api/collab",
  ];
  for (const path of heavy) {
    assert.equal(roleForPath(path), "heavy", path);
  }
});
