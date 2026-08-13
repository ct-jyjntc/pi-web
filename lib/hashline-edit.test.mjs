import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

/** @type {typeof import("./hashline-edit.ts")} */
let hl;
/** @type {typeof import("./hashline-snapshots.ts")} */
let snaps;

before(async () => {
  hl = await jiti.import("./hashline-edit.ts");
  snaps = await jiti.import("./hashline-snapshots.ts");
});

describe("hashline hunk mode", () => {
  it("applies unique oldText with hash guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-hunk-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, "const a = 1;\nconst b = 2;\n");
    const oldText = "const b = 2;";
    const r = hl.applyHashlineEdits(dir, "a.ts", [
      { oldText, newText: "const b = 3;", hash: hl.hashBlock(oldText) },
    ]);
    assert.equal(r.applied, 1);
    assert.match(readFileSync(file, "utf8"), /const b = 3/);
  });

  it("rejects stale block hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-stale-"));
    writeFileSync(join(dir, "a.ts"), "hello\n");
    assert.throws(
      () => hl.applyHashlineEdits(dir, "a.ts", [{ oldText: "hello", newText: "hi", hash: "deadbeef0000" }]),
      /hash mismatch/,
    );
  });

  it("rejects overlapping hunks and leaves the file unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-overlap-"));
    const file = join(dir, "a.ts");
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    writeFileSync(file, content);
    assert.throws(
      () => hl.applyHashlineEdits(dir, "a.ts", [
        { oldText: "const a = 1;\nconst b = 2;\n", newText: "const a = 10;\n" },
        { oldText: "const b = 2;\nconst c = 3;\n", newText: "const c = 30;\n" },
      ]),
      /overlap/,
    );
    assert.equal(readFileSync(file, "utf8"), content);
  });

  it("allows adjacent hunks", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-adj-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, "const a = 1;\nconst b = 2;\n");
    hl.applyHashlineEdits(dir, "a.ts", [
      { oldText: "const a = 1;\n", newText: "const a = 10;\n" },
      { oldText: "const b = 2;\n", newText: "const b = 20;\n" },
    ]);
    assert.equal(readFileSync(file, "utf8"), "const a = 10;\nconst b = 20;\n");
  });

describe("hashline lock paths", () => {
  it("includes MV dest", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-lock-"));
    const paths = hl.collectHashlineLockPaths(
      dir,
      "[a.ts#ABCD]\nMV b.ts\n",
    );
    assert.equal(paths.length, 2);
    assert.ok(paths[0].endsWith("a.ts") || paths[1].endsWith("a.ts"));
    assert.ok(paths[0].endsWith("b.ts") || paths[1].endsWith("b.ts"));
  });
});

describe("hashline op overlap", () => {
  it("rejects overlapping SWAP ranges", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-swap-ol-"));
    const file = join(dir, "a.ts");
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    assert.throws(
      () => hl.applyHashlinePatch(
        dir,
        `[a.ts#${tag}]\nSWAP 1.=3:\n+const a = 10;\nSWAP 2.=4:\n+const d = 40;\n`,
      ),
      /overlap/,
    );
    assert.equal(readFileSync(file, "utf8"), content);
  });
});
});

describe("hashline patch language", () => {
  it("parses SWAP / DEL / INS", () => {
    const { sections } = hl.parseHashlinePatch(
      "[foo.ts#ABCD]\nSWAP 2.=2:\n+const x = 1\nDEL 3\nINS.POST 1:\n+// hi\n",
    );
    assert.equal(sections.length, 1);
    assert.equal(sections[0].path, "foo.ts");
    assert.equal(sections[0].ops.length, 3);
    assert.equal(sections[0].ops[0].kind, "swap");
    assert.equal(sections[0].ops[1].kind, "del");
    assert.equal(sections[0].ops[2].kind, "ins");
  });

  it("accepts SWAP N:M: colon range (session 019ffa3b)", () => {
    const { sections } = hl.parseHashlinePatch(
      "[foo.ts#ABCD]\nSWAP 141:141:\n+const x = 1\n",
    );
    assert.equal(sections[0].ops[0].kind, "swap");
    assert.equal(sections[0].ops[0].start, 141);
    assert.equal(sections[0].ops[0].end, 141);
    assert.deepEqual(sections[0].ops[0].body, ["const x = 1"]);
  });

  it("drops unified-diff minus rows when plus rows exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-udiff-"));
    const file = join(dir, "m.tsx");
    const content = "export function M() {\n  return (\n    <Dialog width={380} label=\"x\">\n      <div />\n    </Dialog>\n  );\n}\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    hl.applyHashlinePatch(
      dir,
      `[m.tsx#${tag}]\nSWAP 3:3:\n-    <Dialog width={380} label="x">\n+    <Dialog width={380} zIndex={1300} label="x">\n`,
    );
    const out = readFileSync(file, "utf8");
    assert.match(out, /zIndex=\{1300\}/);
    assert.doesNotMatch(out, /^-    <Dialog/m);
    assert.match(out, /<\/Dialog>/);
  });

  it("applies patch when tag matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-patch-"));
    const file = join(dir, "greet.py");
    const content = "def greet(name):\n    msg = \"Hello\"\n    print(msg)\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    const patch = `[greet.py#${tag}]
SWAP 2.=2:
+    msg = f"Hi, {name}"
INS.POST 1:
+    if not name: name = "x"
`;
    const results = hl.applyHashlinePatch(dir, patch);
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
      () => hl.applyHashlinePatch(dir, "[a.ts#0000]\nDEL 1\n"),
      /Stale or wrong tag/,
    );
  });

  it("DEL and INS.HEAD work", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-del-"));
    const file = join(dir, "a.txt");
    const content = "a\nb\nc\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    hl.applyHashlinePatch(dir, `[a.txt#${tag}]\nDEL 2\nINS.HEAD:\n+# head\n`);
    const out = readFileSync(file, "utf8");
    assert.equal(out, "# head\na\nc\n");
  });

  it("accepts trailing colon on DEL", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-del-colon-"));
    const file = join(dir, "a.txt");
    const content = "a\nb\nc\nd\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    hl.applyHashlinePatch(dir, `[a.txt#${tag}]\nDEL 2.=3:\n`);
    assert.equal(readFileSync(file, "utf8"), "a\nd\n");
  });

  it("reinterprets count-style N.=K when end < start", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-count-"));
    const file = join(dir, "a.txt");
    // Models often write SWAP 5.=3 meaning "3 lines from 5" → 5..=7
    const content = "L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    const results = hl.applyHashlinePatch(
      dir,
      `[a.txt#${tag}]\nSWAP 5.=3:\n+X5\n+X6\n+X7\n`,
    );
    assert.match(results[0].summary ?? "", /Interpreted 5\.=3 as count/);
    assert.equal(readFileSync(file, "utf8"), "L1\nL2\nL3\nL4\nX5\nX6\nX7\nL8\n");
  });

  it("rejects placeholder tags with recovery hint", () => {
    assert.throws(
      () => hl.parseHashlinePatch("[lib/foo.ts#XXXX]\nDEL 1\n"),
      /Placeholder or invalid tag/,
    );
    assert.throws(
      () => hl.parseHashlinePatch("[lib/foo.ts#TAG]\nSWAP 1.=1:\n+x\n"),
      /Placeholder or invalid tag/,
    );
  });

  it("SWAP.BLK resolves brace block", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-blk-"));
    const file = join(dir, "f.ts");
    const content = "export function hi() {\n  return 1;\n}\nconst x = 2;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    const results = hl.applyHashlinePatch(
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
    const tag = hl.computeFileTag(content);
    hl.applyHashlinePatch(dir, `[p.py#${tag}]\nDEL.BLK 1\n`);
    assert.equal(readFileSync(file, "utf8"), "z = 3\n");
  });

  it("rejects unparsable TS and leaves file unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-syntax-"));
    const file = join(dir, "a.ts");
    const content = "export function hi() {\n  return 1;\n}\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    assert.throws(
      () =>
        hl.applyHashlinePatch(
          dir,
          `[a.ts#${tag}]\nSWAP 1.=3:\n+export function hi() {\n+  return 1;\n+}\n+} catch (e) {\n+}\n`,
        ),
      /Edit rejected: would leave unparsable[\s\S]*Would-be source around first error/,
    );
    assert.equal(readFileSync(file, "utf8"), content);
  });

  it("rejects bare code at op level with body-prefix hint", () => {
    // After a blank line ends a SWAP body, leftover code is parsed as a new op.
    assert.throws(
      () =>
        hl.parseHashlinePatch(
          "[a.ts#ABCD]\nSWAP 1.=1:\n+const y = 1;\n\ncase \"set_mode\": {\n",
        ),
      /Hashline body lines must start with '\+'/,
    );
  });

  it("soft-warns when edited file is ≥800 lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-big-"));
    const file = join(dir, "big.ts");
    const lines = Array.from({ length: 800 }, (_, i) => `const v${i} = ${i};`);
    const content = `${lines.join("\n")}\n`;
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    const results = hl.applyHashlinePatch(
      dir,
      `[big.ts#${tag}]\nSWAP 1.=1:\n+const v0 = 99;\n`,
    );
    assert.match(results[0].summary ?? "", /≥800/);
    assert.ok(results[0].largeFileWarning);
    assert.match(readFileSync(file, "utf8"), /const v0 = 99/);
  });
});


describe("stale-tag recovery", () => {
  it("recovers parallel same-file edits via snapshot anchors", () => {
    snaps.clearHashlineSnapshots();
    const dir = mkdtempSync(join(tmpdir(), "hl-recover-"));
    const file = join(dir, "a.ts");
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    snaps.recordHashlineSnapshot(file, content.replace(/\r\n/g, "\n"), tag);

    // First edit advances the tag.
    const r1 = hl.applyHashlinePatch(
      dir,
      `[a.ts#${tag}]\nSWAP 1.=1:\n+const a = 10;\n`,
    );
    assert.equal(r1[0].tag !== tag, true);
    assert.match(readFileSync(file, "utf8"), /const a = 10/);

    // Second edit still uses the original tag — should recover.
    const r2 = hl.applyHashlinePatch(
      dir,
      `[a.ts#${tag}]\nSWAP 4.=4:\n+const d = 40;\n`,
    );
    assert.match(r2[0].summary ?? "", /Recovered from stale tag/);
    const out = readFileSync(file, "utf8");
    assert.match(out, /const a = 10/);
    assert.match(out, /const d = 40/);
  });

  it("still rejects stale tag without a snapshot", () => {
    snaps.clearHashlineSnapshots();
    const dir = mkdtempSync(join(tmpdir(), "hl-nosnap-"));
    writeFileSync(join(dir, "a.ts"), "one\ntwo\n");
    assert.throws(
      () => hl.applyHashlinePatch(dir, "[a.ts#0000]\nDEL 1\n"),
      /Stale or wrong tag/,
    );
  });

  it("applies INS.HEAD despite stale tag without snapshot", () => {
    snaps.clearHashlineSnapshots();
    const dir = mkdtempSync(join(tmpdir(), "hl-head-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, "const x = 1;\n");
    // Wrong tag, head insert is content-independent
    hl.applyHashlinePatch(dir, "[a.ts#0000]\nINS.HEAD:\n+// top\n");
    assert.equal(readFileSync(file, "utf8"), "// top\nconst x = 1;\n");
  });

  it("remaps anchors when an earlier insert shifts later lines", () => {
    snaps.clearHashlineSnapshots();
    const dir = mkdtempSync(join(tmpdir(), "hl-shift-"));
    const file = join(dir, "a.ts");
    const content = "L1\nL2\nL3\nL4\nL5\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    snaps.recordHashlineSnapshot(file, content, tag);

    hl.applyHashlinePatch(
      dir,
      `[a.ts#${tag}]\nSWAP 1.=1:\n+L1\n+INSERTED\n`,
    );
    // Original line 5 is now line 6; recovery should find L5 uniquely.
    const r2 = hl.applyHashlinePatch(
      dir,
      `[a.ts#${tag}]\nSWAP 5.=5:\n+L5-changed\n`,
    );
    assert.match(r2[0].summary ?? "", /Remapped SWAP 5\.=5 → 6\.=6|Recovered from stale tag/);
    assert.equal(readFileSync(file, "utf8"), "L1\nINSERTED\nL2\nL3\nL4\nL5-changed\n");
  });
});

describe("PUT/CUT aliases", () => {
  it("parses PUT/CUT as SWAP/DEL", () => {
    const { sections } = hl.parseHashlinePatch(
      "[foo.ts#ABCD]\nPUT 2.=3:\n+const x = 1\nCUT 4\nPUT >1:\n+// hi\n",
    );
    assert.equal(sections[0].ops.length, 3);
    assert.equal(sections[0].ops[0].kind, "swap");
    assert.equal(sections[0].ops[1].kind, "del");
    assert.equal(sections[0].ops[2].kind, "ins");
    assert.equal(sections[0].ops[2].at, "post");
  });

  it("applies PUT N*: as SWAP.BLK", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-put-blk-"));
    const file = join(dir, "f.ts");
    const content = "export function hi() {\n  return 1;\n}\nconst x = 2;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    hl.applyHashlinePatch(
      dir,
      `[f.ts#${tag}]\nPUT 1*:\n+export function hi() {\n+  return 42;\n+}\n`,
    );
    const out = readFileSync(file, "utf8");
    assert.match(out, /return 42/);
    assert.match(out, /const x = 2/);
  });
});

describe("same-path section merge", () => {
  it("applies two same-tag sections against the original snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-merge-"));
    const file = join(dir, "a.ts");
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    hl.applyHashlinePatch(
      dir,
      `[a.ts#${tag}]\nINS.HEAD:\n+// head\n[a.ts#${tag}]\nSWAP 3.=3:\n+const c = 30;\n`,
    );
    assert.equal(readFileSync(file, "utf8"), "// head\nconst a = 1;\nconst b = 2;\nconst c = 30;\n");
  });
});

describe("short-SWAP leftover-tail repair", () => {
  it("extends a short SWAP to the block closer when that restores parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-extend-"));
    const file = join(dir, "a.ts");
    const content = "export function hi() {\n  return 1;\n  // keep? leftover\n}\nconst x = 2;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    const results = hl.applyHashlinePatch(
      dir,
      `[a.ts#${tag}]\nSWAP 1.=2:\n+export function hi() {\n+  return 42;\n+}\n`,
    );
    assert.match(results[0].summary ?? "", /Extended SWAP 1\.=2 → 1\.=4/);
    const out = readFileSync(file, "utf8");
    assert.match(out, /return 42/);
    assert.match(out, /const x = 2/);
    assert.doesNotMatch(out, /leftover/);
  });

  it("still rejects an incomplete wrap (does not invent a closer)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-nowrap-"));
    const file = join(dir, "a.ts");
    const content = "export function hi() {\n  return 1;\n}\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    assert.throws(
      () =>
        hl.applyHashlinePatch(
          dir,
          `[a.ts#${tag}]\nSWAP 1.=1:\n+export function hi() {\n+  return {\n`,
        ),
      /Edit rejected: would leave unparsable/,
    );
    assert.equal(readFileSync(file, "utf8"), content);
  });

  it("does not widen a 2-line SWAP that is not a full construct", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-no-widen-"));
    const file = join(dir, "a.ts");
    const content = "export function hi() {\n  return 1;\n  // keep\n}\nconst x = 2;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    assert.throws(
      () =>
        hl.applyHashlinePatch(
          dir,
          `[a.ts#${tag}]\nSWAP 1.=2:\n+const a = 1;\n+const b = 2;\n`,
        ),
      /Edit rejected: would leave unparsable/,
    );
    assert.equal(readFileSync(file, "utf8"), content);
  });
});

describe("atomic multi-file apply", () => {
  it("writes nothing when a later section is unparsable", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-atomic-"));
    const a = join(dir, "a.ts");
    const b = join(dir, "b.ts");
    const aContent = "export const a = 1;\n";
    const bContent = "export function hi() {\n  return 1;\n}\n";
    writeFileSync(a, aContent);
    writeFileSync(b, bContent);
    const aTag = hl.computeFileTag(aContent);
    const bTag = hl.computeFileTag(bContent);
    assert.throws(
      () =>
        hl.applyHashlinePatch(
          dir,
          `[a.ts#${aTag}]\nSWAP 1.=1:\n+export const a = 2;\n[b.ts#${bTag}]\nSWAP 1.=3:\n+export function hi() {\n+  return 1;\n+}\n+} catch (e) {\n+}\n`,
        ),
      /unparsable/,
    );
    assert.equal(readFileSync(a, "utf8"), aContent);
    assert.equal(readFileSync(b, "utf8"), bContent);
  });
});

describe("post-edit preview", () => {
  it("returns [path#TAG] and post-edit N:line rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-prev-"));
    const file = join(dir, "greet.ts");
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    writeFileSync(file, content);
    const tag = hl.computeFileTag(content);
    const results = hl.applyHashlinePatch(
      dir,
      `[greet.ts#${tag}]\nSWAP 2.=2:\n+const b = 20;\n`,
    );
    const preview = results[0].preview ?? "";
    assert.match(preview, new RegExp(`\\[greet.ts#${results[0].tag}\\]`));
    assert.match(preview, /2:const b = 20;/);
    assert.match(results[0].summary ?? "", /2:const b = 20;/);
  });
});
