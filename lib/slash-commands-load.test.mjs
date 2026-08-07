import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mergeSlashCommandLists } = await jiti.import("./slash-commands-load.ts");

test("merge prefers session rows and keeps missing light skills", () => {
  const custom = [{ name: "mycmd", source: "custom" }];
  const fromSession = [
    { name: "skill:foo", source: "skill" },
    { name: "ext-cmd", source: "extension" },
  ];
  const skills = [
    { name: "skill:foo", source: "skill", description: "light" },
    { name: "skill:bar", source: "skill" },
  ];
  const merged = mergeSlashCommandLists(custom, fromSession, skills);
  assert.deepEqual(
    merged.map((c) => c.name),
    ["mycmd", "skill:foo", "ext-cmd", "skill:bar"],
  );
  assert.equal(merged.find((c) => c.name === "skill:foo")?.description, undefined);
});
