import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { getGitStatus } from "./git-changes";
import type { GitStatusResponse } from "./git-types";
import { gitProcessEnv, resolveGitBinary } from "./resolve-git";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), ["-C", cwd, ...args], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      env: gitProcessEnv(),
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string | Buffer; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "";
    throw new Error((stderr || err.message || "git failed").trim());
  }
}

async function repoRoot(cwd: string): Promise<string> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) throw new Error("Not a git repository");
  return root;
}

export async function isMergeInProgress(cwd: string): Promise<boolean> {
  try {
    const root = await repoRoot(cwd);
    return fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))
      || fs.existsSync(path.join(root, ".git", "rebase-merge"))
      || fs.existsSync(path.join(root, ".git", "CHERRY_PICK_HEAD"));
  } catch {
    return false;
  }
}

export async function completeMergeCommit(
  cwd: string,
  message?: string,
): Promise<{ commit: string | null; status: GitStatusResponse }> {
  const root = await repoRoot(cwd);
  const status = await getGitStatus(cwd);
  if (status.conflictCount > 0) {
    throw new Error("Resolve merge conflicts before completing the merge");
  }
  if (!await isMergeInProgress(cwd)) {
    throw new Error("No merge/rebase/cherry-pick in progress");
  }

  const msg = (message?.trim() || "Merge branch").slice(0, 200);
  try {
    await git(root, ["commit", "--no-edit", "-m", msg]);
  } catch {
    // --no-edit may fail if no MERGE_MSG; retry with explicit message
    await git(root, ["commit", "-m", msg]);
  }

  let commit: string | null = null;
  try {
    commit = (await git(root, ["rev-parse", "--short", "HEAD"])).trim() || null;
  } catch {
    commit = null;
  }
  return { commit, status: await getGitStatus(cwd) };
}
