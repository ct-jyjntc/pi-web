import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  isWorkspaceMutatingTool,
  notifyWorkspaceFilesChanged,
  subscribeWorkspaceFilesChanged,
} = await jiti.import("./workspace-change-notify.ts");

test("isWorkspaceMutatingTool only matches write and edit", () => {
  assert.equal(isWorkspaceMutatingTool("write"), true);
  assert.equal(isWorkspaceMutatingTool("edit"), true);
  assert.equal(isWorkspaceMutatingTool("read"), false);
  assert.equal(isWorkspaceMutatingTool("bash"), false);
  assert.equal(isWorkspaceMutatingTool(undefined), false);
});

test("subscribe receives notify and unsubscribes", () => {
  const hits = [];
  const unsub = subscribeWorkspaceFilesChanged(() => hits.push(1));
  notifyWorkspaceFilesChanged();
  assert.equal(hits.length, 1);
  unsub();
  notifyWorkspaceFilesChanged();
  assert.equal(hits.length, 1);
});
