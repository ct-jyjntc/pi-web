import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-ops.ts");
}

test("validateEntryName rejects empty, paths, and dots", async () => {
  const { validateEntryName } = await loadSubject();

  assert.equal(validateEntryName("notes.md"), null);
  assert.equal(validateEntryName("my folder"), null);
  assert.match(validateEntryName(""), /empty/);
  assert.match(validateEntryName("  padded  "), /spaces/);
  assert.match(validateEntryName("."), /Invalid/);
  assert.match(validateEntryName(".."), /Invalid/);
  assert.match(validateEntryName("a/b"), /path/);
  assert.match(validateEntryName("a\\b"), /path/);
});

test("create / rename / copy / move / delete round-trip", async (t) => {
  const {
    createEmptyFile,
    createDirectory,
    renameEntry,
    copyEntry,
    moveEntry,
    deleteEntry,
    isPathInsideOrEqual,
  } = await loadSubject();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-ops-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const filePath = await createEmptyFile(root, "a.txt");
  assert.equal(fs.readFileSync(filePath, "utf8"), "");

  const dirPath = await createDirectory(root, "nested");
  assert.equal(fs.statSync(dirPath).isDirectory(), true);

  const renamed = await renameEntry(filePath, "b.txt");
  assert.equal(path.basename(renamed), "b.txt");
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(renamed), true);

  const copyDest = path.join(dirPath, "b-copy.txt");
  await copyEntry(renamed, copyDest);
  assert.equal(fs.readFileSync(copyDest, "utf8"), "");
  assert.equal(fs.existsSync(renamed), true);

  const moveDest = path.join(dirPath, "b-moved.txt");
  await moveEntry(renamed, moveDest);
  assert.equal(fs.existsSync(renamed), false);
  assert.equal(fs.existsSync(moveDest), true);

  assert.equal(isPathInsideOrEqual(dirPath, copyDest), true);
  assert.equal(isPathInsideOrEqual(dirPath, root), false);

  await assert.rejects(() => copyEntry(dirPath, path.join(dirPath, "loop")), /itself/);

  await deleteEntry(dirPath);
  assert.equal(fs.existsSync(dirPath), false);
});

test("create refuses overwrite via wx / mkdir", async (t) => {
  const { createEmptyFile, createDirectory } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-ops-exist-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await createEmptyFile(root, "x.txt");
  await assert.rejects(() => createEmptyFile(root, "x.txt"), (err) => err.code === "EEXIST");

  await createDirectory(root, "d");
  await assert.rejects(() => createDirectory(root, "d"), (err) => err.code === "EEXIST");
});
