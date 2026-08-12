/**
 * Initialize a git repository at an allowed cwd. Owns the write + cache
 * invalidation so the next getGitStatus() sees the new repo.
 */
import { invalidateGitStatusCache, runGit } from "./git-changes";

export async function initGitRepository(cwd: string): Promise<{ repositoryRoot: string }> {
  await runGit(cwd, ["init"]);
  invalidateGitStatusCache();
  const repositoryRoot = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!repositoryRoot) throw new Error("git init did not produce a repository");
  return { repositoryRoot };
}
