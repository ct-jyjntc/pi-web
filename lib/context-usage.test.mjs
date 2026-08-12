/** Cold-open context window must come from on-disk catalogs, never ModelRuntime. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function withAgentDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-context-usage-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`);
    }
    const mod = await jiti.import("./context-usage.ts");
    await fn(mod, dir);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveModelContextWindow prefers models.json", async () => {
  await withAgentDir({
    "models.json": {
      providers: {
        Grok: { models: [{ id: "grok-4.6", contextWindow: 500000 }] },
      },
    },
    "builtin-provider-models-cache.json": {
      version: 1,
      providers: {
        Grok: { updatedAt: 1, models: [{ id: "grok-4.6", contextWindow: 111 }] },
      },
    },
  }, async ({ resolveModelContextWindow }) => {
    assert.equal(
      await resolveModelContextWindow("/tmp", { provider: "Grok", modelId: "grok-4.6" }),
      500000,
    );
  });
});

test("resolveModelContextWindow falls back to builtin cache for OAuth models", async () => {
  await withAgentDir({
    "models.json": { providers: {} },
    "builtin-provider-models-cache.json": {
      version: 1,
      providers: {
        "kimi-coding": {
          updatedAt: 1,
          models: [{ id: "k3-256k", contextWindow: 262144 }],
        },
      },
    },
  }, async ({ resolveModelContextWindow, estimateSessionContextUsage }) => {
    assert.equal(
      await resolveModelContextWindow("/tmp", { provider: "kimi-coding", modelId: "k3-256k" }),
      262144,
    );
    const usage = await estimateSessionContextUsage({
      cwd: "/tmp",
      model: { provider: "Kimi-Coding", modelId: "K3-256K" },
      messages: [{ role: "user", content: "hello world ".repeat(50) }],
    });
    assert.ok(usage);
    assert.equal(usage.contextWindow, 262144);
    assert.ok(usage.tokens != null && usage.tokens > 0);
    assert.ok(usage.percent != null && usage.percent > 0);
  });
});

test("resolveModelContextWindow falls back to models-store then overrides", async () => {
  await withAgentDir({
    "models.json": { providers: {} },
    "models-store.json": {
      "openai-codex": { models: [{ id: "gpt-5.4", contextWindow: 272000 }] },
    },
    "model-overrides.json": {
      "nous/hermes-4-70b": { contextWindow: 200000 },
    },
  }, async ({ resolveModelContextWindow }) => {
    assert.equal(
      await resolveModelContextWindow("/tmp", { provider: "openai-codex", modelId: "gpt-5.4" }),
      272000,
    );
    assert.equal(
      await resolveModelContextWindow("/tmp", { provider: "nous", modelId: "hermes-4-70b" }),
      200000,
    );
    assert.equal(
      await resolveModelContextWindow("/tmp", { provider: "missing", modelId: "nope" }),
      null,
    );
  });
});
