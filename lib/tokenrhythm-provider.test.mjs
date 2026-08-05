import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Same "@" alias the runtime configures; without it the module under test
// cannot resolve its own "@/lib/..." imports.
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") },
});

const {
  TOKENRHYTHM_BASE_URL,
  TOKENRHYTHM_DISPLAY_NAME,
  TOKENRHYTHM_PROVIDER_ID,
  createTokenRhythmProvider,
} = await jiti.import("./tokenrhythm-provider.ts");

test("tokenrhythm native provider matches API-key provider shape", () => {
  const provider = createTokenRhythmProvider();
  assert.equal(provider.id, TOKENRHYTHM_PROVIDER_ID);
  assert.equal(provider.name, TOKENRHYTHM_DISPLAY_NAME);
  assert.equal(provider.baseUrl, TOKENRHYTHM_BASE_URL);
  assert.equal(typeof provider.auth.apiKey?.login, "function");
  const models = provider.getModels();
  assert.ok(models.length >= 1);
  assert.equal(models.every((m) => m.provider === TOKENRHYTHM_PROVIDER_ID), true);
  assert.equal(models.every((m) => m.api === "openai-completions"), true);
  assert.equal(models.every((m) => m.baseUrl === TOKENRHYTHM_BASE_URL), true);
  assert.ok(models.some((m) => m.id === "deepseek-v4-flash"));
});
