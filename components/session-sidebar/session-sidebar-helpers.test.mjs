import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getProjectActivity } = await jiti.import("./session-sidebar-helpers.ts");

test("collapses worktree sessions onto projectRoot", () => {
  const sessions = [
    { id: "a", cwd: "/repo-wt", projectRoot: "/repo" },
    { id: "b", cwd: "/repo", projectRoot: "/repo" },
    { id: "c", cwd: "/other", projectRoot: "/other" },
  ];
  const map = getProjectActivity(
    sessions,
    new Set(["a"]),
    new Set(["c"]),
  );
  assert.deepEqual(map.get("/repo"), { running: true, unread: false });
  assert.deepEqual(map.get("/other"), { running: false, unread: true });
  assert.equal(map.has("/missing"), false);
});
