import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkSourceSyntax,
  formatSyntaxGuardFailure,
  isSyntaxGuardedPath,
} from "./edit-syntax-guard.ts";

describe("edit-syntax-guard", () => {
  it("guards only JS/TS paths", () => {
    assert.equal(isSyntaxGuardedPath("a.ts"), true);
    assert.equal(isSyntaxGuardedPath("a.tsx"), true);
    assert.equal(isSyntaxGuardedPath("a.py"), false);
    assert.equal(isSyntaxGuardedPath("a.md"), false);
  });

  it("accepts valid TS", () => {
    const r = checkSourceSyntax("ok.ts", "const x = 1;\nexport function f() { return x; }\n");
    assert.equal(r.ok, true);
  });

  it("rejects unparsable TS before write callers act", () => {
    const r = checkSourceSyntax(
      "bad.ts",
      "export function f() {\n  return 1;\n}\n} catch (e) {\n}\n",
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errors.length >= 1);
    const msg = formatSyntaxGuardFailure("bad.ts", r);
    assert.match(msg, /Edit rejected/);
    assert.match(msg, /not modified/);
  });

  it("rejects incomplete expressions", () => {
    const r = checkSourceSyntax("x.ts", "const x = (\n");
    assert.equal(r.ok, false);
  });

  it("skips non-JS content", () => {
    const r = checkSourceSyntax("note.md", "### not code {\n");
    assert.equal(r.ok, true);
  });
});
