import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  readBuiltinProviderModelsCache,
  writeBuiltinProviderModelsCache,
  clearBuiltinProviderModelsCache,
  resolveCachedModelContextWindow,
} = await jiti.import("./builtin-provider-models-cache.ts");

test("builtin provider models cache round-trip reapplies disabled flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-builtin-cache-"));
  const path = join(dir, "builtin-provider-models-cache.json");
  try {
    writeBuiltinProviderModelsCache(
      "openai",
      {
        displayName: "OpenAI",
        models: [
          {
            id: "gpt-4o",
            name: "GPT-4o",
            reasoning: false,
            reasoningEditable: true,
            supportsImage: true,
            disabled: true,
          },
          {
            id: "o3",
            name: "o3",
            reasoning: true,
            reasoningEditable: false,
            supportsImage: false,
            disabled: false,
          },
        ],
      },
      { path },
    );

    // Without denylist file, both should read disabled=false (stripped on write).
    const cached = readBuiltinProviderModelsCache("openai", { path });
    assert.ok(cached);
    assert.equal(cached.displayName, "OpenAI");
    assert.equal(cached.models.length, 2);
    assert.equal(cached.models[0].id, "gpt-4o");
    assert.equal(cached.models[0].disabled, false);
    assert.ok(cached.updatedAt > 0);

    clearBuiltinProviderModelsCache("openai", { path });
    assert.equal(readBuiltinProviderModelsCache("openai", { path }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing cache returns null", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-builtin-cache-empty-"));
  const path = join(dir, "missing.json");
  try {
    assert.equal(readBuiltinProviderModelsCache("x", { path }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCachedModelContextWindow matches case-insensitively", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-builtin-cache-cw-"));
  const path = join(dir, "builtin-provider-models-cache.json");
  try {
    writeBuiltinProviderModelsCache(
      "kimi-coding",
      {
        models: [
          {
            id: "k3-256k",
            name: "k3",
            reasoning: true,
            reasoningEditable: false,
            supportsImage: false,
            disabled: false,
            contextWindow: 262144,
          },
        ],
      },
      { path },
    );
    assert.equal(resolveCachedModelContextWindow("kimi-coding", "k3-256k", { path }), 262144);
    assert.equal(resolveCachedModelContextWindow("Kimi-Coding", "K3-256K", { path }), 262144);
    assert.equal(resolveCachedModelContextWindow("kimi-coding", "missing", { path }), null);
    assert.equal(resolveCachedModelContextWindow("other", "k3-256k", { path }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
