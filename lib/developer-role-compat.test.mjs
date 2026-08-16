import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// jiti so we can load .ts without Node ESM extension resolution (production code
// imports `./developer-role-compat` extensionless for Next/tsc bundler resolution).
const jiti = createJiti(import.meta.url);
const { isDeveloperRoleHost, normalizeDeveloperRoleCompat } = await jiti.import(
  "./developer-role-compat.ts",
);

test("stamps supportsDeveloperRole:false on unknown OpenAI-compatible hosts", () => {
  const out = normalizeDeveloperRoleCompat({
    providers: {
      ark: {
        api: "openai-completions",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        models: [{ id: "glm-5.3", reasoning: true }],
      },
    },
  });
  assert.equal(out.providers.ark.compat.supportsDeveloperRole, false);
  // Model entries untouched — provider-level compat merges via mergeCompat.
  assert.deepEqual(out.providers.ark.models, [{ id: "glm-5.3", reasoning: true }]);
});

test("stamps openai-responses custom proxies too", () => {
  const out = normalizeDeveloperRoleCompat({
    providers: {
      grok: { api: "openai-responses", baseUrl: "https://2.26.200.160:8787/v1" },
    },
  });
  assert.equal(out.providers.grok.compat.supportsDeveloperRole, false);
});

test("leaves known developer-role hosts to SDK auto-detection", () => {
  for (const baseUrl of ["https://api.openai.com/v1", "https://openrouter.ai/api/v1"]) {
    const out = normalizeDeveloperRoleCompat({
      providers: { p: { api: "openai-completions", baseUrl } },
    });
    assert.equal(out.providers.p.compat, undefined, baseUrl);
  }
});

test("respects an explicit user choice, both true and false", () => {
  const out = normalizeDeveloperRoleCompat({
    providers: {
      on: {
        api: "openai-completions",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        compat: { supportsDeveloperRole: true },
      },
      off: {
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        compat: { supportsDeveloperRole: false },
      },
    },
  });
  assert.equal(out.providers.on.compat.supportsDeveloperRole, true);
  assert.equal(out.providers.off.compat.supportsDeveloperRole, false);
});

test("strips legacy dead keys and drops an emptied compat object", () => {
  const out = normalizeDeveloperRoleCompat({
    providers: {
      legacyOpenAI: {
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        compat: { developerRole: true },
      },
      legacyCustom: {
        api: "openai-completions",
        baseUrl: "https://example.com/v1",
        compat: { useDeveloperRole: true, thinkingFormat: "deepseek" },
      },
    },
  });
  assert.equal(out.providers.legacyOpenAI.compat, undefined);
  assert.deepEqual(out.providers.legacyCustom.compat, {
    thinkingFormat: "deepseek",
    supportsDeveloperRole: false,
  });
});

test("ignores non-OpenAI APIs but still strips legacy keys", () => {
  const out = normalizeDeveloperRoleCompat({
    providers: {
      claude: {
        api: "anthropic-messages",
        baseUrl: "https://example.com",
        compat: { developerRole: true },
      },
    },
  });
  assert.equal(out.providers.claude.compat, undefined);
});

test("passes through malformed entries untouched", () => {
  const data = { providers: { weird: "nope", garbageCompat: { api: "openai-completions", compat: "x" } } };
  assert.deepEqual(normalizeDeveloperRoleCompat(data), data);
  assert.deepEqual(normalizeDeveloperRoleCompat({}), {});
  assert.deepEqual(normalizeDeveloperRoleCompat({ providers: null }), { providers: null });
});

test("is idempotent", () => {
  const data = {
    providers: {
      ark: { api: "openai-completions", baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3" },
    },
  };
  const once = normalizeDeveloperRoleCompat(data);
  assert.deepEqual(normalizeDeveloperRoleCompat(once), once);
});

test("isDeveloperRoleHost matching is case-insensitive substring, like pi-ai", () => {
  assert.equal(isDeveloperRoleHost("https://API.OPENAI.COM/v1"), true);
  assert.equal(isDeveloperRoleHost("https://openrouter.ai/api/v1"), true);
  assert.equal(isDeveloperRoleHost("https://ark.cn-beijing.volces.com/api/plan/v3"), false);
  assert.equal(isDeveloperRoleHost(undefined), false);
});
