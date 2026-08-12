import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

/** @type {typeof import("./edit-syntax-guard.ts")} */
let guard;

before(async () => {
  guard = await jiti.import("./edit-syntax-guard.ts");
});

describe("edit-syntax-guard", () => {
  it("guards only JS/TS paths", () => {
    assert.equal(guard.isSyntaxGuardedPath("a.ts"), true);
    assert.equal(guard.isSyntaxGuardedPath("a.tsx"), true);
    assert.equal(guard.isSyntaxGuardedPath("a.py"), false);
    assert.equal(guard.isSyntaxGuardedPath("a.md"), false);
  });

  it("loads typescript from the app install", () => {
    guard.clearTypescriptCache();
    const ts = guard.loadTypescript();
    assert.ok(ts, "typescript must resolve from pi-web node_modules");
    assert.equal(typeof ts.createSourceFile, "function");
  });

  it("accepts valid TS", () => {
    const r = guard.checkSourceSyntax("ok.ts", "const x = 1;\nexport function f() { return x; }\n");
    assert.equal(r.ok, true);
  });

  it("accepts regex character classes and nested template literals (former false positive)", () => {
    // Mirrors the hashline-edit.ts patterns that the old bracket-balance
    // fallback rejected as: Unmatched '}' (opened '[' …).
    const src = [
      "export function parseRange(a: string, b: string | undefined) {",
      "  const start = Number(a);",
      "  let end = b !== undefined && b !== \"\" ? Number(b) : start;",
      "  if (end < start) {",
      "    const count = end;",
      "    end = start + count - 1;",
      "    const msg =",
      "      `Interpreted ${start}.=${count} as count → lines ${start}.=${end} ` +",
      "      `(N.=M is inclusive end line, not line count; prefer SWAP ${start}.=${end}:)`;",
      "    void msg;",
      "  }",
      "  return { start, end };",
      "}",
      "",
      "export function looksLikeCloser(openLine: string): boolean {",
      "  return /^[}\\])]+\\s*;?\\s*$/.test(openLine.trim());",
      "}",
      "",
    ].join("\n");
    const r = guard.checkSourceSyntax("range.ts", src);
    assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.errors));
  });

  it("accepts the real hashline-edit.ts on disk (regression for this session)", () => {
    const src = readFileSync(new URL("./hashline-edit.ts", import.meta.url), "utf8");
    const r = guard.checkSourceSyntax("lib/hashline-edit.ts", src);
    assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.errors));
  });

  it("rejects unparsable TS before write callers act", () => {
    const src = "export function f() {\n  return 1;\n}\n} catch (e) {\n}\n";
    const r = guard.checkSourceSyntax("bad.ts", src);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errors.length >= 1);
    const msg = guard.formatSyntaxGuardFailure("bad.ts", r, src);
    assert.match(msg, /Edit rejected/);
    assert.match(msg, /not modified/);
    assert.match(msg, /Would-be source around first error/);
  });

  it("rejects incomplete expressions", () => {
    const r = guard.checkSourceSyntax("x.ts", "const x = (\n");
    assert.equal(r.ok, false);
  });

  it("skips non-JS content", () => {
    const r = guard.checkSourceSyntax("note.md", "### not code {\n");
    assert.equal(r.ok, true);
  });

  it("fails open when typescript cannot be loaded (no false reject)", () => {
    guard.setTypescriptForTests(null);
    try {
      // Even blatantly broken source must not hard-block without a real parser.
      const r = guard.checkSourceSyntax("z.ts", "function ({\n} catch {\n");
      assert.equal(r.ok, true);
    } finally {
      guard.clearTypescriptCache();
    }
    // Parser back: real rejects still work.
    assert.equal(guard.checkSourceSyntax("z.ts", "function ({\n").ok, false);
  });
});
