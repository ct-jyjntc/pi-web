import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./last-chat-model.ts");
  } catch {
    return import("./last-chat-model.ts");
  }
}

const {
  parseLastChatModel,
  lastChatModelsEqual,
  pickNewSessionSeed,
  initialNewSessionSeed,
  reconcileNewSessionLastChat,
} = await loadSubject();

const CATALOG = [
  { provider: "anthropic", id: "claude-sonnet-4-6" },
  { provider: "openai", id: "gpt-5" },
];

test("parseLastChatModel accepts provider/modelId/thinkingLevel", () => {
  assert.deepEqual(
    parseLastChatModel({ provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "high" }),
    { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "high" },
  );
});

test("parseLastChatModel treats missing thinking as auto and rejects junk", () => {
  assert.equal(parseLastChatModel(null), null);
  assert.equal(parseLastChatModel("anthropic/claude-sonnet-4-6"), null);
  assert.deepEqual(
    parseLastChatModel({ provider: "  openai ", modelId: " gpt-5 ", thinkingLevel: "nope" }),
    { provider: "openai", modelId: "gpt-5", thinkingLevel: "auto" },
  );
});

test("lastChatModelsEqual compares provider, id, and thinking", () => {
  const a = { provider: "openai", modelId: "gpt-5", thinkingLevel: "low" };
  assert.equal(lastChatModelsEqual(a, { ...a }), true);
  assert.equal(lastChatModelsEqual(a, { ...a, thinkingLevel: "high" }), false);
  assert.equal(lastChatModelsEqual(a, null), false);
});

test("pickNewSessionSeed uses last before the catalog is ready", () => {
  const last = { provider: "openai", modelId: "gpt-5", thinkingLevel: "medium" };
  assert.deepEqual(
    pickNewSessionSeed({ last, catalog: [], catalogReady: false }),
    { model: { provider: "openai", modelId: "gpt-5" }, thinkingLevel: "medium", fromLast: true },
  );
});

test("pickNewSessionSeed drops a last model that is not in the catalog", () => {
  const last = { provider: "gone", modelId: "old", thinkingLevel: "high" };
  assert.deepEqual(
    pickNewSessionSeed({ last, catalog: CATALOG, catalogReady: true }),
    { model: null, thinkingLevel: null, fromLast: false },
  );
});

test("initialNewSessionSeed is empty for existing sessions", () => {
  assert.deepEqual(
    initialNewSessionSeed(false, { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" }, CATALOG),
    { model: null, thinkingLevel: null, fromLast: false },
  );
});

test("reconcile keeps a still-visible current pick", () => {
  const result = reconcileNewSessionLastChat({
    current: { provider: "openai", modelId: "gpt-5" },
    last: { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "high" },
    catalog: CATALOG,
    currentThinking: "low",
  });
  assert.deepEqual(result, {
    model: { provider: "openai", modelId: "gpt-5" },
    thinkingLevel: "low",
    applyConfiguredThinking: false,
  });
});

test("reconcile applies last when there is no current pick", () => {
  const result = reconcileNewSessionLastChat({
    current: null,
    last: { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "xhigh" },
    catalog: CATALOG,
    currentThinking: "auto",
  });
  assert.deepEqual(result, {
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    thinkingLevel: "xhigh",
    applyConfiguredThinking: false,
  });
});

test("reconcile does not let configured thinking overwrite an explicit auto last pick", () => {
  const result = reconcileNewSessionLastChat({
    current: null,
    last: { provider: "openai", modelId: "gpt-5", thinkingLevel: "auto" },
    catalog: CATALOG,
    currentThinking: "auto",
  });
  assert.equal(result.applyConfiguredThinking, false);
  assert.equal(result.thinkingLevel, "auto");
});

test("reconcile falls back to configured thinking when last is gone", () => {
  const result = reconcileNewSessionLastChat({
    current: { provider: "gone", modelId: "old" },
    last: { provider: "gone", modelId: "old", thinkingLevel: "high" },
    catalog: CATALOG,
    currentThinking: "high",
  });
  assert.deepEqual(result, {
    model: null,
    thinkingLevel: "auto",
    applyConfiguredThinking: true,
  });
});
