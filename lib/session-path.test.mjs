import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-path.ts");
}

test("normalizes session path keys case-insensitively on Windows", async () => {
  const { sessionPathKey } = await loadSubject();
  assert.equal(sessionPathKey("C:\\Users\\Alex\\a.jsonl", "win32"), "c:\\users\\alex\\a.jsonl");
  assert.equal(sessionPathKey("/Users/Alex/a.jsonl", "linux"), "/Users/Alex/a.jsonl");
});
