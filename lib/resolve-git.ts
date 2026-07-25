import { env, platform } from "process";

/**
 * Always use the system `git` on PATH.
 *
 * Portable/bundled git breaks macOS Keychain / credential helpers
 * (e.g. "could not read Username for 'https://github.com': Device not configured").
 */
export function resolveGitBinary(): string {
  return platform === "win32" ? "git.exe" : "git";
}

/** Env for git child processes — system git only, no portable overrides. */
export function gitProcessEnv(base: NodeJS.ProcessEnv = env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...base, LC_ALL: base.LC_ALL || "C" };
  // Drop any leftover portable-git env from older app versions.
  delete next.PI_WEB_GIT_BINARY;
  delete next.GIT_EXEC_PATH;
  delete next.GIT_TEMPLATE_DIR;
  return next;
}
