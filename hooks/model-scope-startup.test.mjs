import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Startup invariants in useAgentSession, asserted against the source because the
 * hook needs a React harness to run.
 *
 * These pin the *guard conditions*, not naming: delete one and the model or
 * thinking level silently starts clobbering a choice the user made, which is
 * near-invisible in the UI.
 *
 * (The previous version of this file asserted an implementation — override refs
 * named `newSessionModelOverrideRef` / `thinkingLevelOverrideRef` — that was
 * never committed, so it had failed since the day it was added.)
 */
const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

function slice(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to);
  assert.ok(start !== -1, `anchor missing: ${from}`);
  assert.ok(end > start, `anchor missing or out of order: ${to}`);
  return source.slice(start, end);
}

test("model-list refresh only applies defaults to a new session", () => {
  const loadModels = slice("const loadModels = useCallback", "const handleBuiltinSlashCommand");

  // A live session keeps whatever it was restored with, so the defaults block
  // stays behind `isNew`.
  const branch = loadModels.indexOf("if (isNew) {");
  assert.ok(branch !== -1, "loadModels must gate its defaults on isNew");
  assert.ok(
    loadModels.indexOf("setNewSessionDefaultModel(") > branch,
    "setNewSessionDefaultModel must sit inside the isNew branch",
  );
});

test("model-list refresh never overwrites an explicit thinking level", () => {
  const loadModels = slice("const loadModels = useCallback", "const handleBuiltinSlashCommand");

  // "auto" is the sentinel for "user has not chosen"; every refresh-time write
  // to the thinking level must sit inside a block guarded by it. Brace-matching
  // rather than "nearest if" so a nested write still counts as covered.
  const guarded = [];
  for (const guard of loadModels.matchAll(/thinkingLevel === "auto"/g)) {
    const open = loadModels.indexOf("{", guard.index);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < loadModels.length; i += 1) {
      if (loadModels[i] === "{") depth += 1;
      else if (loadModels[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          guarded.push([open, i]);
          break;
        }
      }
    }
  }

  const writes = [...loadModels.matchAll(/setThinkingLevel\(/g)];
  assert.ok(writes.length > 0, "expected loadModels to set a thinking level");
  for (const write of writes) {
    assert.ok(
      guarded.some(([start, end]) => write.index > start && write.index < end),
      'every setThinkingLevel in loadModels must sit inside a thinkingLevel === "auto" guard',
    );
  }
});

test("new-session startup omits a thinking level the user never chose", () => {
  const ensure = slice("const ensureNewSession", "const loadCustomSlashCommands");

  // Sending "auto" would pin it server-side as though it were a real choice.
  assert.match(ensure, /thinkingLevel !== "auto" \? \{ thinkingLevel \} : \{\}/);
  // Likewise the model is only sent when one is actually selected.
  assert.match(ensure, /selectedModel \? \{ provider: selectedModel\.provider/);
});
