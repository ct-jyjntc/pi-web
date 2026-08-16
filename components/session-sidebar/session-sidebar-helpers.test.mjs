import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getProjectActivity, getRecentProjects, sessionsForProject } = await jiti.import("./session-sidebar-helpers.ts");

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

test("recent projects dedupe by server projectKey and display the newest root", () => {
  const sessions = [
    { id: "a", cwd: "C:\\Repo", projectRoot: "C:\\Repo", projectKey: "c:\\repo", modified: "2026-08-12T00:00:00.000Z" },
    { id: "b", cwd: "c:/repo", projectRoot: "c:/repo", projectKey: "c:\\repo", modified: "2026-08-13T00:00:00.000Z" },
    { id: "c", cwd: "D:\\Other", projectRoot: "D:\\Other", projectKey: "d:\\other", modified: "2026-08-11T00:00:00.000Z" },
  ];
  assert.deepEqual(getRecentProjects(sessions), [
    { key: "c:\\repo", root: "c:/repo" },
    { key: "d:\\other", root: "D:\\Other" },
  ]);
});

test("sessionsForProject matches on stable identity, not raw paths", () => {
  const sessions = [
    { id: "a", cwd: "C:\\Repo", projectRoot: "C:\\Repo", projectKey: "c:\\repo" },
    { id: "b", cwd: "c:/repo/", projectRoot: "c:/repo/", projectKey: "c:\\repo" },
    { id: "c", cwd: "D:\\Other", projectRoot: "D:\\Other", projectKey: "d:\\other" },
  ];
  assert.deepEqual(
    sessionsForProject(sessions, "c:\\repo").map((s) => s.id),
    ["a", "b"],
  );
});

test("activity aggregates Windows path variants under one key", () => {
  const sessions = [
    { id: "a", cwd: "C:\\Repo", projectRoot: "C:\\Repo", projectKey: "c:\\repo" },
    { id: "b", cwd: "c:/repo", projectRoot: "c:/repo", projectKey: "c:\\repo" },
  ];
  const map = getProjectActivity(sessions, new Set(["a"]), new Set(["b"]));
  assert.deepEqual(map.get("c:\\repo"), { running: true, unread: true });
  assert.equal(map.size, 1);
});
