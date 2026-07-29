import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_PROVIDERS,
  filterFreeModelIds,
  freeProviderByKey,
  getFreeProvider,
  isFreeManagedProvider,
} from "./free-providers.ts";

test("catalog includes OpenCode Zen free provider", () => {
  const def = getFreeProvider("opencode-zen-free");
  assert.ok(def);
  assert.equal(def.providerKey, "opencode-zen");
  assert.equal(def.baseUrl, "https://opencode.ai/zen/v1");
  assert.equal(freeProviderByKey("opencode-zen")?.id, "opencode-zen-free");
  assert.equal(FREE_PROVIDERS.length >= 1, true);
});

test("filters only -free model ids", () => {
  const def = getFreeProvider("opencode-zen-free");
  assert.ok(def);
  const ids = filterFreeModelIds(def, [
    "claude-sonnet-4",
    "deepseek-v4-flash-free",
    "deepseek-v4-flash-free",
    "  mimo-v2.5-free  ",
    "",
    "gpt-5",
  ]);
  assert.deepEqual(ids, ["deepseek-v4-flash-free", "mimo-v2.5-free"]);
});

test("detects managed free providers", () => {
  assert.equal(isFreeManagedProvider({ managed: "opencode-zen-free" }), true);
  assert.equal(isFreeManagedProvider({ managed: "nope" }), false);
  assert.equal(isFreeManagedProvider({}), false);
  assert.equal(isFreeManagedProvider(null), false);
});
