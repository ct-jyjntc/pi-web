import assert from "node:assert/strict";
import test from "node:test";

const { formatSkillPrompt, displaySkillName } = await import("./skill-invoke.ts");
const { setDraft, getDraft, clearDraft } = await import("./draft-store.ts");

test("formatSkillPrompt wraps user text with /skill:name", () => {
  assert.equal(formatSkillPrompt("brainstorming", "a new app"), "/skill:brainstorming a new app");
  assert.equal(formatSkillPrompt("brainstorming", "  "), "/skill:brainstorming");
  assert.equal(formatSkillPrompt(undefined, "hello"), "hello");
  assert.equal(formatSkillPrompt("review", "/skill:other x"), "/skill:other x");
});

test("displaySkillName title-cases hyphenated ids", () => {
  assert.equal(displaySkillName("brainstorming"), "Brainstorming");
  assert.equal(displaySkillName("ctf-ai-ml"), "Ctf AI ML");
  assert.equal(displaySkillName("规划·头脑风暴"), "规划·头脑风暴");
});

test("draft store keeps a skill-only composer attachment", () => {
  const key = "new:/tmp/try-skill";
  clearDraft(key);
  setDraft(key, { value: "", images: [], attachedSkill: { name: "review" } });
  assert.equal(getDraft(key)?.attachedSkill?.name, "review");
  setDraft(key, { value: "", images: [] });
  assert.equal(getDraft(key), null);
});
