import assert from "node:assert/strict";
import { describe, it } from "node:test";

const DEFAULT = {
  enabled: true,
  autoInjectTopK: 12,
  maxFactChars: 400,
  maxInjectChars: 3000,
};

function parseProjectMemorySettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT };
  const clamp = (n, fallback, min, max) => {
    const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
  };
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT.enabled,
    autoInjectTopK: clamp(value.autoInjectTopK, DEFAULT.autoInjectTopK, 0, 50),
    maxFactChars: clamp(value.maxFactChars, DEFAULT.maxFactChars, 80, 2000),
    maxInjectChars: clamp(value.maxInjectChars, DEFAULT.maxInjectChars, 200, 12000),
  };
}

describe("parseProjectMemorySettings", () => {
  it("defaults and clamps", () => {
    const d = parseProjectMemorySettings(null);
    assert.equal(d.enabled, true);
    assert.equal(d.autoInjectTopK, 12);
    const c = parseProjectMemorySettings({ enabled: false, autoInjectTopK: 999 });
    assert.equal(c.enabled, false);
    assert.equal(c.autoInjectTopK, 50);
  });
});
