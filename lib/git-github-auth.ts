/**
 * Per-command git auth for the connected GitHub account. Owns the env overlay
 * so push/publish/pull do not put the token on argv (ps / execFile errors).
 */

export type GitAuthEnv = Record<string, string>;

export function isGithubHttpsRemote(url: string): boolean {
  return /^https:\/\/(?:[^/@]+@)?github\.com\//i.test(url.trim());
}

/**
 * GIT_CONFIG_* overlay: disable helpers and send Authorization for this
 * process only. Nothing is written to .git/config.
 */
export function githubGitAuthEnv(token: string): GitAuthEnv {
  const auth = Buffer.from(`${token}:x-oauth-basic`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.extraHeader",
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${auth}`,
  };
}

export function githubAuthEnv(
  token: string | undefined,
  remoteUrl: string | null | undefined,
): GitAuthEnv | undefined {
  if (!token || !remoteUrl || !isGithubHttpsRemote(remoteUrl)) return undefined;
  return githubGitAuthEnv(token);
}

/** Strip Authorization material from git stderr / execFile messages. */
export function redactGitAuth(text: string): string {
  return text
    .replace(/Authorization:\s*Basic\s+\S+/gi, "Authorization: Basic [redacted]")
    .replace(/http\.extraHeader=\S+/gi, "http.extraHeader=[redacted]");
}
