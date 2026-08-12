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

  const { fullName, htmlUrl } = await createGithubRepo(account.token, name, visibility);

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

    // Push with the token as http extra header (CI-standard), helpers disabled
    // so the user's Keychain / gh login is not consulted or modified. The `-c`
    // flags are per-command only — nothing is persisted to .git/config.
    const auth = Buffer.from(`${account.token}:x-oauth-basic`).toString("base64");
    const out = await runGit(
      repositoryRoot,
      [
        "-c", "credential.helper=",
        "-c", `http.extraHeader=Authorization: Basic ${auth}`,
        "push", "-u", "origin", "HEAD",
      ],
      GIT_REMOTE_MAX_BUFFER,
      GIT_NETWORK_TIMEOUT_MS,
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
