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

// --- files shipped ---
for (const rel of [
  "lib/lean-mode-settings.ts",
  "lib/lean-policy.ts",
  "lib/lean-settings.ts",
  "lib/lean-review.ts",
  "lib/lean-paths.ts",
  "lib/lean-hard-gate.ts",
  "lib/lean-project-file.ts",
  "app/api/lean-review/route.ts",
  "app/api/lean-project/route.ts",
  "components/LeanReviewCard.tsx",
  "components/settings/LeanModeSettingsSection.tsx",
  "hooks/useLeanReviewOnAgentEnd.ts",
]) {
  mustExist(rel);
}

// --- source contains turn-scoped diff (no silent full-tree auto) ---
const reviewSrc = readFileSync(join(root, "lib/lean-review.ts"), "utf8");
assert.match(reviewSrc, /collectTurnDiff/);
assert.match(reviewSrc, /no-paths/);
assert.match(reviewSrc, /allowFullWorktree/);

// --- idle session reset on leanMode write ---
const webSettingsRoute = readFileSync(join(root, "app/api/web-settings/route.ts"), "utf8");
assert.match(webSettingsRoute, /destroyIdleRpcSessions/);

// --- hard gate wired into edit tool ---
const editTool = readFileSync(join(root, "lib/agent-edit-tool.ts"), "utf8");
assert.match(editTool, /resolveHardGateForCwd/);
assert.match(editTool, /checkLargeFileNetGrowth/);

// --- path extraction logic (inline mirror of lean-paths) ---
function pathsFromToolCall(toolName, input) {
  const out = new Set();
  if (input && typeof input === "object" && typeof input.path === "string") out.add(input.path);
  if (input && typeof input === "object" && typeof input.input === "string") {
    for (const m of input.input.matchAll(/\[(.+?)#[0-9A-Fa-f]{4}\]/g)) out.add(m[1]);
  }
  return [...out];
}
assert.deepEqual(
  pathsFromToolCall("edit", { input: "[src/foo.ts#ab12]\nSWAP 1.=2:\n+x\n" }),
  ["src/foo.ts"],
);

// --- policy intensity markers present in source ---
const policy = readFileSync(join(root, "lib/lean-policy.ts"), "utf8");
assert.match(policy, /Hard intensity/);
assert.match(policy, /### Review/);
assert.match(policy, /### Tone/);

console.log("smoke-lean-mode: ok (static checks)");
console.log("Manual UI still recommended:");
console.log("  1) soft: policy only, no auto review");
console.log("  2) review + edit: card only for touched paths");
console.log("  3) hard: large-file net growth rejected");
console.log("  4) toggle lean: idle sessions reset note");
console.log("  5) project .pi-web.json override");
