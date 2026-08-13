import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { samePath, toPosixPath } = await jiti.import("./paths.ts");

test("normalizes slashes", () => {
  assert.equal(toPosixPath("C:\\a\\b"), "C:/a/b");
});

test("samePath is case-insensitive only on win32", () => {
  if (process.platform === "win32") {
    assert.equal(samePath("C:\\\\Repo", "c:/repo"), true);
  } else {
    assert.equal(samePath("/Repo", "/repo"), false);
    assert.equal(samePath("/repo/", "/repo"), true);
  }
});
