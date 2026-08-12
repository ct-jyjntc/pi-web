/**
 * Owns the "publish a local repo to GitHub" flow: detect remotes, create the
 * remote repo through the connected account's token (REST API), wire `origin`,
 * and push with the token inline — without touching the user's gh CLI login or
 * git credential helpers. Light-runtime safe (system git + fetch, no SDK).
 */
import { getGithubAccount } from "./accounts-store";
import {
  createGithubRepo,
  validateGithubRepoName,
} from "./github-oauth";
import { githubGitAuthEnv } from "./git-github-auth";
import {
  getGitStatus,
  invalidateGitStatusCache,
  runGit,
  GIT_NETWORK_TIMEOUT_MS,
} from "./git-changes";

const GIT_REMOTE_MAX_BUFFER = 8 * 1024 * 1024;

async function repositoryRootOf(cwd: string): Promise<string> {
  const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) throw new Error("Not a git repository");
  return root;
}

export async function listRemotes(cwd: string): Promise<string[]> {
  try {
    const root = await repositoryRootOf(cwd);
    return (await runGit(root, ["remote"])).split("\n").map((r) => r.trim()).filter(Boolean);
  } catch (error) {
    if (error instanceof Error && error.message === "Not a git repository") throw error;
    return [];
  }
}

export type PublishResult = {
  message: string;
  repoUrl: string;
  fullName: string;
  status: Awaited<ReturnType<typeof getGitStatus>>;
};

/**
 * Create `<name>` on GitHub (private/public), point `origin` at it and push the
 * current branch with upstream tracking. Fails with a clear error when the user
 * is not connected or the repo has no commits yet.
 */
export async function publishToGithub(
  cwd: string,
  name: string,
  visibility: "private" | "public",
): Promise<PublishResult> {
  const invalid = validateGithubRepoName(name);
  if (invalid) throw new Error(invalid);

  const account = getGithubAccount();
  if (!account) throw new Error("Not signed in to GitHub");

  const repositoryRoot = await repositoryRootOf(cwd);

  // No commits → nothing to push; fail before creating a repo.
  try {
    await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    throw new Error("The repository has no commits yet — commit first, then publish");
  }

  let created: { fullName: string; htmlUrl: string };
  try {
    created = await createGithubRepo(account.token, name, visibility);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // POST /user/repos 422 "already exists" is this user's namespace — reuse.
    if (!/already exists/i.test(msg)) throw error;
    const fullName = `${account.login}/${name}`;
    created = { fullName, htmlUrl: `https://github.com/${fullName}` };
  }
  const { fullName, htmlUrl } = created;

  try {
    // Re-check remotes (a remote could have appeared between the push attempt
    // and now); origin may already exist with a stale URL.
    const remotes = (await runGit(repositoryRoot, ["remote"]))
      .split("\n").map((r) => r.trim()).filter(Boolean);
    const originUrl = `https://github.com/${fullName}.git`;
    if (remotes.includes("origin")) {
      await runGit(repositoryRoot, ["remote", "set-url", "origin", originUrl]);
    } else {
      await runGit(repositoryRoot, ["remote", "add", "origin", originUrl]);
    }

    // Token rides in GIT_CONFIG_* env (not argv) so execFile / ps cannot echo it.
    const out = await runGit(
      repositoryRoot,
      ["push", "-u", "origin", "HEAD"],
      GIT_REMOTE_MAX_BUFFER,
      GIT_NETWORK_TIMEOUT_MS,
      githubGitAuthEnv(account.token),
    );

    invalidateGitStatusCache();
    return {
      message: (out || "Published").trim() || "Published",
      repoUrl: htmlUrl,
      fullName,
      status: await getGitStatus(cwd),
    };
  } catch (error) {
    invalidateGitStatusCache();
    throw error;
  }
}
