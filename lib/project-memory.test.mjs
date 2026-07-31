import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

// Point the pi agent dir at a throwaway temp dir BEFORE importing the module
// under test (getAgentDir() reads PI_CODING_AGENT_DIR at call time).
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-mem-test-agent-"));

// The project uses extensionless relative TS imports; teach Node's type
// stripping to resolve "./x" → "./x.ts".
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.[a-z0-9]+$/i.test(specifier)) {
      return next(specifier + ".ts", context);
    }
    throw err;
  }
}
`)}`);

const pm = await import("./project-memory.ts");
const {
  DEFAULT_PROJECT_MEMORY,
  applyMemoryOperations,
  buildMemoryInjectBlock,
  listMemoryFacts,
  memoryStoreUsage,
  projectMemoryDir,
  recallMemoryFacts,
  removeMemoryFactByText,
  replaceMemoryFact,
  retainMemoryFact,
} = pm;

/**
 * Fresh agent dir + project cwd per test so project-memory keys stay isolated.
 */
function fresh() {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-mem-test-agent-"));
  return mkdtempSync(join(tmpdir(), "pi-mem-test-cwd-"));
}

/** Small-budget settings so overflow is easy to trigger in tests. */
function tightSettings(overrides = {}) {
  return {
    ...DEFAULT_PROJECT_MEMORY,
    projectBudgetChars: 500,
    ...overrides,
  };
}

describe("parseProjectMemorySettings", () => {
  it("defaults and clamps", () => {
    const d = pm.parseProjectMemorySettings(null);
    assert.equal(d.enabled, false);
    assert.equal(d.autoInject, false);
    assert.equal(d.autoInjectTopK, 12);
    assert.equal(d.projectBudgetChars, 4000);
    const c = pm.parseProjectMemorySettings({ enabled: false, autoInjectTopK: 999, projectBudgetChars: 5 });
    assert.equal(c.enabled, false);
    assert.equal(c.autoInjectTopK, 50);
    assert.equal(c.projectBudgetChars, 500); // clamped to minimum
  });
});

describe("project store only", () => {
  it("stores facts under project-memory and ignores legacy user scope", () => {
    const cwd = fresh();
    retainMemoryFact(cwd, "project fact alpha", { settings: tightSettings() });
    // Legacy scope:"user" is forced onto project.
    retainMemoryFact(cwd, "legacy user-tagged fact", { settings: tightSettings() });

    const texts = listMemoryFacts(cwd).map((f) => f.text).sort();
    assert.deepEqual(texts, ["legacy user-tagged fact", "project fact alpha"].sort());
    assert.deepEqual(listMemoryFacts(cwd).map((f) => f.text).sort(), texts);
    assert.match(readFileSync(join(projectMemoryDir(cwd), "facts.jsonl"), "utf8"), /project fact alpha/);
  });

  it("recall searches project memory", () => {
    const cwd = fresh();
    retainMemoryFact(cwd, "alpha deploys via blue-green", { settings: tightSettings() });
    retainMemoryFact(cwd, "beta prefers terseness", { settings: tightSettings() });
    assert.deepEqual(
      recallMemoryFacts(cwd, "alpha", 8).map((f) => f.text),
      ["alpha deploys via blue-green"],
    );
  });
});

describe("retainMemoryFact budget guard", () => {
  it("throws consolidation error with entries + instruction on overflow", () => {
    const cwd = fresh();
    const settings = tightSettings();
    // Fill the project store close to its 500-char budget.
    const filler = [
      "filler one: uses pnpm workspaces with a single root lockfile",
      "filler two: integration tests spin up a local postgres container",
      "filler three: release builds are signed in CI on tagged commits",
      "filler four: deploys roll out via a blue-green pair behind nginx",
    ];
    for (const text of filler) retainMemoryFact(cwd, text, { settings });
    const before = listMemoryFacts(cwd);

    let err;
    try {
      retainMemoryFact(cwd, "one more fact that will definitely overflow the budget " + "x".repeat(120), { settings });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected overflow to throw");
    assert.match(err.message, /project memory at \d+\/500 chars/);
    assert.match(err.message, /would exceed the limit/);
    assert.match(err.message, /Consolidate now: use 'replace' to merge overlapping entries or 'remove' to drop stale ones/);
    assert.match(err.message, /all in this turn/);
    // Current entries are echoed with ids.
    for (const f of before) {
      assert.ok(err.message.includes(`[${f.id}]`), `error should echo entry ${f.id}`);
      assert.ok(err.message.includes(f.text), "error should echo entry text");
    }
    // Nothing written.
    assert.equal(listMemoryFacts(cwd).length, before.length);
  });

  it("secret guard still fires", () => {
    const cwd = fresh();
    assert.throws(
      () => retainMemoryFact(cwd, "api_key: sk-abcdefghijklmnop", { settings: tightSettings() }),
      /Refusing to store possible secrets/,
    );
  });

  it("exact-text dedupe still bumps updatedAt without growing the store", () => {
    const cwd = fresh();
    const settings = tightSettings();
    const first = retainMemoryFact(cwd, "project fact alpha", { settings });
    const again = retainMemoryFact(cwd, "project fact alpha", { settings, importance: 0.9 });
    assert.equal(again.id, first.id);
    assert.ok(again.updatedAt >= first.updatedAt);
    assert.equal(again.importance, 0.9);
    assert.equal(listMemoryFacts(cwd).length, 1);
  });
});

describe("replace / remove by substring", () => {
  it("replaces by unique substring, keeping id and createdAt", () => {
    const cwd = fresh();
    const settings = tightSettings({ projectBudgetChars: 20000 });
    const a = retainMemoryFact(cwd, "build uses webpack bundler", { settings });
    retainMemoryFact(cwd, "tests use vitest runner", { settings });

    const replaced = replaceMemoryFact(cwd, "webpack", "build uses vite bundler", { settings });
    assert.equal(replaced.id, a.id);
    assert.equal(replaced.createdAt, a.createdAt);
    assert.ok(replaced.updatedAt >= a.updatedAt);
    assert.equal(replaced.text, "build uses vite bundler");
  });

  it("ambiguous substring error lists candidate ids", () => {
    const cwd = fresh();
    const settings = tightSettings({ projectBudgetChars: 20000 });
    const x = retainMemoryFact(cwd, "lint config shared across packages", { settings });
    const y = retainMemoryFact(cwd, "lint runs in pre-commit hook", { settings });

    let err;
    try {
      replaceMemoryFact(cwd, "lint", "something else", { settings });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected ambiguity to throw");
    assert.match(err.message, /matches 2 memory entries/);
    assert.ok(err.message.includes(`[${x.id}]`) && err.message.includes(`[${y.id}]`));
  });

  it("zero matches is an error; remove deletes by unique substring", () => {
    const cwd = fresh();
    const settings = tightSettings({ projectBudgetChars: 20000 });
    assert.throws(
      () => removeMemoryFactByText(cwd, "no such substring anywhere", { settings }),
      /no memory entry matches/,
    );

    const doomed = retainMemoryFact(cwd, "temporary scaffolding note", { settings });
    const removed = removeMemoryFactByText(cwd, "scaffolding", { settings });
    assert.equal(removed.id, doomed.id);
    assert.ok(!listMemoryFacts(cwd).some((f) => f.id === doomed.id));
  });
});

describe("applyMemoryOperations", () => {
  it("applies an atomic batch and reports changed count", () => {
    const cwd = fresh();
    const settings = tightSettings({ projectBudgetChars: 20000 });
    const { facts, changed } = applyMemoryOperations(cwd, [
      { action: "add", text: "batch fact one" },
      { action: "add", text: "batch fact two" },
      { action: "replace", oldText: "batch fact one", text: "batch fact one (revised)" },
      { action: "remove", oldText: "batch fact two" },
    ], { settings });
    assert.equal(changed, 4);
    assert.deepEqual(facts.map((f) => f.text), ["batch fact one (revised)"]);
  });

  it("is all-or-nothing when one op is bad", () => {
    const cwd = fresh();
    const settings = tightSettings({ projectBudgetChars: 20000 });
    let err;
    try {
      applyMemoryOperations(cwd, [
        { action: "add", text: "should never be committed" },
        { action: "remove", oldText: "substring that matches nothing" },
      ], { settings });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected batch to abort");
    assert.match(err.message, /Operation 2 \(remove\)/);
    assert.equal(listMemoryFacts(cwd).length, 0);
  });

  it("rejects a poisoned batch (secret in any op) without writing", () => {
    const cwd = fresh();
    const settings = tightSettings({ projectBudgetChars: 20000 });
    assert.throws(
      () => applyMemoryOperations(cwd, [
        { action: "add", text: "innocent note" },
        { action: "add", text: "password: hunter2hunter2" },
      ], { settings }),
      /Refusing to store possible secrets/,
    );
    assert.equal(listMemoryFacts(cwd).length, 0);
  });

  it("checks the budget on the FINAL state only (free space + add in one batch)", () => {
    const cwd = fresh();
    const settings = tightSettings();
    // Fill near the 500-char budget (4 × ~117 chars incl. per-fact overhead).
    for (const text of [
      "filler one: uses pnpm workspaces with a single root lockfile shared across all packages every day",
      "filler two: integration tests spin up a local postgres container per individual test run every day",
      "filler three: release builds are signed and notarized in CI on every tagged commit push every day",
      "filler four: deploys roll out via a blue-green pair behind an nginx edge frontend proxy every day",
    ]) retainMemoryFact(cwd, text, { settings });
    const usage = memoryStoreUsage(listMemoryFacts(cwd));
    // A lone add of the replacement fact (24 + 20 overhead) must overflow.
    assert.ok(usage + 44 > 500, `precondition: lone add would overflow (at ${usage})`);
    assert.ok(usage <= 500, `precondition: fill fits (at ${usage})`);

    // A lone add would overflow; removing two entries in the same batch fits.
    const { facts, changed } = applyMemoryOperations(cwd, [
      { action: "remove", oldText: "filler four" },
      { action: "remove", oldText: "filler three" },
      { action: "add", text: "compact replacement fact" },
    ], { settings });
    assert.equal(changed, 3);
    assert.ok(facts.some((f) => f.text === "compact replacement fact"));
    assert.ok(!facts.some((f) => f.text.includes("filler four")));
    assert.ok(memoryStoreUsage(facts) <= 500);
  });

  it("budget overflow echoes entries + consolidation instruction, writes nothing", () => {
    const cwd = fresh();
    const settings = tightSettings();
    retainMemoryFact(cwd, "user prefers terse answers with code first", { settings });
    retainMemoryFact(cwd, "user is staff engineer on the platform team", { settings });
    retainMemoryFact(cwd, "user reviews PRs on tuesdays and thursdays", { settings });
    const before = listMemoryFacts(cwd);

    let err;
    try {
      applyMemoryOperations(cwd, [
        { action: "add", text: "a long new preference that does not fit " + "y".repeat(300) },
      ], { settings });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected batch overflow");
    assert.match(err.message, /After applying all 1 operations, project memory would be at \d+\/500 chars/);
    assert.match(err.message, /over the limit/);
    assert.match(err.message, /Consolidate now:/);
    for (const f of before) assert.ok(err.message.includes(`[${f.id}]`));
    assert.deepEqual(listMemoryFacts(cwd), before);
  });
});

describe("buildMemoryInjectBlock", () => {
  it("injects project memory only when autoInject is enabled", () => {
    const cwd = fresh();
    const settings = tightSettings({
      enabled: true,
      autoInject: true,
      maxInjectChars: 12000,
    });
    retainMemoryFact(cwd, "user prefers dark theme", { settings });
    retainMemoryFact(cwd, "project builds with vite", { settings });

    const block = buildMemoryInjectBlock(cwd, settings);
    assert.ok(block);
    assert.doesNotMatch(block, /## User memory/);
    assert.match(block, /## Project memory \(auto-loaded\)/);
    // Project store keeps every fact; both appear when auto-inject is on.
    assert.match(block, /- user prefers dark theme/);
    assert.match(block, /- project builds with vite/);
    assert.match(block, /memory_recall/);
  });

  it("returns null when empty or autoInject is off", () => {
    const cwd = fresh();
    const settings = tightSettings({
      enabled: true,
      autoInject: true,
      maxInjectChars: 12000,
    });
    assert.equal(buildMemoryInjectBlock(cwd, settings), null);

    retainMemoryFact(cwd, "only project fact here", { settings });
    assert.ok(buildMemoryInjectBlock(cwd, settings));
    assert.equal(
      buildMemoryInjectBlock(cwd, tightSettings({ enabled: true, autoInject: false })),
      null,
    );
  });
});
