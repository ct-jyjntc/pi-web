/**
 * Lean Mode lightweight acceptance checks (pure JS, no Next server).
 * Run: node scripts/smoke-lean-mode.mjs
 *
 * Full UI matrix remains manual (see docs/superpowers/plans lean plan).
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function mustExist(rel) {
  const p = join(root, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return p;
}

// --- surviving files (prompt injection only) ---
for (const rel of [
  "lib/lean-mode-settings.ts",
  "lib/lean-policy.ts",
  "lib/lean-settings.ts",
  "components/settings/LeanModeSettingsSection.tsx",
]) {
  mustExist(rel);
}

// --- deleted: review machinery + hard gates are gone ---
for (const rel of [
  "lib/lean-review.ts",
  "lib/lean-paths.ts",
  "lib/lean-hard-gate.ts",
  "lib/lean-project-file.ts",
  "app/api/lean-review/route.ts",
  "app/api/lean-project/route.ts",
  "components/LeanReviewCard.tsx",
  "hooks/useLeanReviewOnAgentEnd.ts",
]) {
  assert.ok(!existsSync(join(root, rel)), `should have been deleted: ${rel}`);
}

// --- policy text injected into system prompt at session start ---
const sessionStart = readFileSync(join(root, "lib/rpc-session-start.ts"), "utf8");
assert.match(sessionStart, /buildLeanPolicyText/);
assert.match(sessionStart, /appendSystemPromptOverride/);

// --- policy intensity markers present in source ---
const policy = readFileSync(join(root, "lib/lean-policy.ts"), "utf8");
assert.match(policy, /Hard intensity/);
assert.match(policy, /### Review/);
assert.match(policy, /### Tone/);

// --- settings model is slim: enabled + intensity only ---
const settingsModel = readFileSync(join(root, "lib/lean-mode-settings.ts"), "utf8");
assert.match(settingsModel, /export type LeanIntensity/);
assert.ok(!/reviewOnAgentEnd/.test(settingsModel), "reviewOnAgentEnd must be gone from settings model");
assert.ok(!/hardGates/.test(settingsModel), "hardGates must be gone from settings model");

// --- idle session reset on leanMode write (next turn reloads prompt) ---
const webSettingsRoute = readFileSync(join(root, "app/api/web-settings/route.ts"), "utf8");
assert.match(webSettingsRoute, /destroyIdleRpcSessions/);

console.log("smoke-lean-mode: ok (static checks)");
console.log("Manual UI still recommended:");
console.log("  1) soft/review/hard wording differences in system prompt");
console.log("  2) toggle lean: idle sessions reset note");
