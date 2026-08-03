import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Pure helpers mirrored from model-roles / web-settings (node --test cannot resolve
// extensionless TS imports that pull the Next/pi stack).

function parseModelRef(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) return null;
    return {
      provider: trimmed.slice(0, slash).trim(),
      modelId: trimmed.slice(slash + 1).trim(),
    };
  }
  if (!value || typeof value !== "object") return null;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string"
    ? value.modelId.trim()
    : typeof value.id === "string"
      ? value.id.trim()
      : "";
  if (!provider || !modelId) return null;
  const thinkingLevel = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value.thinkingLevel)
    ? value.thinkingLevel
    : undefined;
  return { provider, modelId, ...(thinkingLevel ? { thinkingLevel } : {}) };

}

function formatRoleModelForAgent(role, settings) {
  const ref = settings.modelRoles[role];
  if (!ref) return null;
  const formatted = `${ref.provider}/${ref.modelId}`;
  return ref.thinkingLevel && ref.thinkingLevel !== "auto" && ref.thinkingLevel !== "off"
    ? `${formatted}:${ref.thinkingLevel}`
    : formatted;
}
function parseModelRoles(value) {
  const base = { default: null, smol: null, plan: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  return {
    default: parseModelRef(value.default),
    smol: parseModelRef(value.smol),
    plan: parseModelRef(value.plan),
  };
}

function roleFallbackChain(role, settings) {
  const roles = settings.modelRoles;
  if (role === "default") return [roles.default];
  if (role === "smol") return [roles.smol, settings.commitModel, settings.titleModel, roles.default];
  return [roles.plan, roles.default];
}

describe("parseModelRoles", () => {
  it("parses string and object refs", () => {
    const roles = parseModelRoles({
      default: "zenmux/claude-sonnet-4-6",
      smol: { provider: "zenmux", modelId: "claude-haiku-4-5", thinkingLevel: "medium" },
      plan: { provider: "openai", id: "gpt-5" },
    });
    assert.deepEqual(roles.default, { provider: "zenmux", modelId: "claude-sonnet-4-6" });
    assert.deepEqual(roles.smol, {
      provider: "zenmux",
      modelId: "claude-haiku-4-5",
      thinkingLevel: "medium",
    });
    assert.deepEqual(roles.plan, { provider: "openai", modelId: "gpt-5" });
  });

  it("ignores invalid role values", () => {
    const roles = parseModelRoles({ default: "bad", smol: {}, plan: "a/b" });
    assert.equal(roles.default, null);
    assert.equal(roles.smol, null);
    assert.deepEqual(roles.plan, { provider: "a", modelId: "b" });
  });
});

describe("thinking preferences", () => {
  const settings = {
    modelRoles: {
      default: { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
      smol: { provider: "openai", modelId: "gpt-5", thinkingLevel: "off" },
      plan: null,
    },
  };

  it("formats an enabled level for delegated agents", () => {
    assert.equal(formatRoleModelForAgent("default", settings), "openai/gpt-5:high");
  });

  it("keeps off as the base model ref", () => {
    assert.equal(formatRoleModelForAgent("smol", settings), "openai/gpt-5");
  });
});

describe("roleFallbackChain", () => {
  const settings = {
    titleModel: { provider: "t", modelId: "title" },
    commitModel: { provider: "c", modelId: "commit" },
    modelRoles: {
      default: { provider: "d", modelId: "default" },
      smol: null,
      plan: null,
    },
  };

  it("smol falls back through commit/title/default", () => {
    assert.deepEqual(roleFallbackChain("smol", settings), [
      null,
      { provider: "c", modelId: "commit" },
      { provider: "t", modelId: "title" },
      { provider: "d", modelId: "default" },
    ]);
  });
});
