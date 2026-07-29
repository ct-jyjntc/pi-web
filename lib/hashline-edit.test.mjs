import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyHashlineEdits,
  applyHashlinePatch,
  computeFileTag,
  hashBlock,
  parseHashlinePatch,
} from "./hashline-edit.ts";

describe("hashline hunk mode", () => {
  it("applies unique oldText with hash guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-hunk-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, "const a = 1;\nconst b = 2;\n");
    const oldText = "const b = 2;";
    const r = applyHashlineEdits(dir, "a.ts", [
      { oldText, newText: "const b = 3;", hash: hashBlock(oldText) },
    ]);
    assert.equal(r.applied, 1);
    assert.match(readFileSync(file, "utf8"), /const b = 3/);
  });

  it("rejects stale block hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-stale-"));
    writeFileSync(join(dir, "a.ts"), "hello\n");
    assert.throws(
      () => applyHashlineEdits(dir, "a.ts", [{ oldText: "hello", newText: "hi", hash: "deadbeef0000" }]),
      /hash mismatch/,
    );
  });
});

describe("hashline patch language", () => {
  it("parses SWAP / DEL / INS", () => {
    const { sections } = parseHashlinePatch(
      "[foo.ts#ABCD]\nSWAP 2.=2:\n+const x = 1\nDEL 3\nINS.POST 1:\n+// hi\n",
    );
    assert.equal(sections.length, 1);
    assert.equal(sections[0].path, "foo.ts");
    assert.equal(sections[0].ops.length, 3);
    assert.equal(sections[0].ops[0].kind, "swap");
    assert.equal(sections[0].ops[1].kind, "del");
    assert.equal(sections[0].ops[2].kind, "ins");
  });

  it("applies patch when tag matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-patch-"));
    const file = join(dir, "greet.py");
    const content = "def greet(name):\n    msg = \"Hello\"\n    print(msg)\n";
    writeFileSync(file, content);
    const tag = computeFileTag(content);
    const patch = `[greet.py#${tag}]
SWAP 2.=2:
+    msg = f"Hi, {name}"
INS.POST 1:
+    if not name: name = "x"
`;
    const results = applyHashlinePatch(dir, patch);
    assert.equal(results.length, 1);
    assert.equal(results[0].applied, 2);
    const out = readFileSync(file, "utf8");
    assert.match(out, /if not name/);
    assert.match(out, /Hi, \{name\}/);
  });

  it("rejects stale tag with recovery hint", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-tag-"));
    writeFileSync(join(dir, "a.ts"), "one\ntwo\n");
    assert.throws(
      () => applyHashlinePatch(dir, "[a.ts#0000]\nDEL 1\n"),
      /Stale or wrong tag/,
    );
  });

  it("DEL and INS.HEAD work", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-del-"));
    const file = join(dir, "a.txt");
    const content = "a\nb\nc\n";
    writeFileSync(file, content);
    const tag = computeFileTag(content);
    applyHashlinePatch(dir, `[a.txt#${tag}]\nDEL 2\nINS.HEAD:\n+# head\n`);
    const out = readFileSync(file, "utf8");
    assert.equal(out, "# head\na\nc\n");
  });

  it("SWAP.BLK resolves brace block", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-blk-"));
    const file = join(dir, "f.ts");
    const content = "export function hi() {\n  return 1;\n}\nconst x = 2;\n";
    writeFileSync(file, content);
    const tag = computeFileTag(content);
    const results = applyHashlinePatch(
      dir,
      `[f.ts#${tag}]\nSWAP.BLK 1:\n+export function hi() {\n+  return 42;\n+}\n`,
    );
    assert.match(results[0].summary, /SWAP\.BLK 1 → lines 1-3/);
    assert.ok(results[0].diff && results[0].diff.includes("-  return 1;"));
    assert.ok(results[0].diff.includes("+  return 42;"));
    const out = readFileSync(file, "utf8");
    assert.match(out, /return 42/);
    assert.match(out, /const x = 2/);
  });

  it("DEL.BLK resolves indent block", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-ind-"));
    const file = join(dir, "p.py");
    const content = "def foo():\n    x = 1\n    y = 2\nz = 3\n";
    writeFileSync(file, content);
    const tag = computeFileTag(content);
    applyHashlinePatch(dir, `[p.py#${tag}]\nDEL.BLK 1\n`);
    assert.equal(readFileSync(file, "utf8"), "z = 3\n");
  });
});
