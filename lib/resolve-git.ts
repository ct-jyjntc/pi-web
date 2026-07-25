import { existsSync } from "fs";
import { delimiter, dirname, join } from "path";
import { env, platform } from "process";
import { homedir } from "os";

/**
 * Resolve a git executable for all server-side git operations.
 * Preference:
 *   1. PI_WEB_GIT_BINARY / GIT_EXEC_PATH-adjacent bundled git
 *   2. Packaged standalone/git/bin/git
 *   3. PATH / common install locations
 */
export function resolveGitBinary(): string {
  if (env.PI_WEB_GIT_BINARY && existsSync(env.PI_WEB_GIT_BINARY)) {
    return env.PI_WEB_GIT_BINARY;
  }

  const name = platform === "win32" ? "git.exe" : "git";
  const candidates: string[] = [];

  // Next to bundled Node (standalone/bin) → ../git/bin/git
  if (env.PI_WEB_NODE && existsSync(env.PI_WEB_NODE)) {
    candidates.push(join(dirname(env.PI_WEB_NODE), "..", "git", "bin", name));
  }
  candidates.push(
    join(process.cwd(), "git", "bin", name),
    join(process.cwd(), "standalone", "git", "bin", name),
  );

  // System locations (fallback)
  if (platform === "darwin") {
    candidates.push("/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git");
  } else if (platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
    );
  } else {
    candidates.push("/usr/bin/git", "/usr/local/bin/git");
  }

  const home = homedir();
  candidates.push(join(home, ".local", "bin", "git"));

  const pathEnv = env.PATH ?? env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    candidates.push(join(dir, name));
  }

  for (const c of candidates) {
    try {
      if (c && existsSync(c)) return c;
    } catch {
      // try next
    }
  }

  // Last resort: rely on PATH resolution at spawn time
  return name;
}

/** Env for git child processes — prefer bundled git's exec-path when present. */
export function gitProcessEnv(base: NodeJS.ProcessEnv = env): NodeJS.ProcessEnv {
  const gitBin = resolveGitBinary();
  const next: NodeJS.ProcessEnv = { ...base, LC_ALL: base.LC_ALL || "C" };

  // If we resolved a full path, put its directory first on PATH so subcommands
  // (and any shell-outs from hooks) see the same git.
  if (gitBin.includes("/") || gitBin.includes("\\")) {
    const binDir = dirname(gitBin);
    const pathKey = platform === "win32" ? "Path" : "PATH";
    const sep = platform === "win32" ? ";" : ":";
    const parts = String(next[pathKey] || "").split(sep).filter(Boolean);
    if (!parts.includes(binDir)) parts.unshift(binDir);
    next[pathKey] = parts.join(sep);

    // dugite-native layout: git/libexec/git-core
    const execPath = join(dirname(binDir), "libexec", "git-core");
    if (existsSync(execPath)) {
      next.GIT_EXEC_PATH = execPath;
    }
    const templateDir = join(dirname(binDir), "share", "git-core", "templates");
    if (existsSync(templateDir)) {
      next.GIT_TEMPLATE_DIR = templateDir;
    }
  }

  next.PI_WEB_GIT_BINARY = gitBin;
  return next;
}
