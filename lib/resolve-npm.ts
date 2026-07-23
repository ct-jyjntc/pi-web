import { existsSync } from "fs";
import { delimiter, dirname, join } from "path";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { execPath, env, platform } from "process";

/**
 * Locate a usable `npm` binary. GUI/Electron launches often have a stripped PATH
 * that does not include user Node installs (Homebrew, nvm, fnm, hermes, …), which
 * surfaces as `spawn npm ENOENT` from pi's DefaultPackageManager.
 */
export function resolveNpmBinary(): string | null {
  const candidates: string[] = [];

  // Explicit override
  if (env.PI_WEB_NPM && existsSync(env.PI_WEB_NPM)) {
    return env.PI_WEB_NPM;
  }

  // Same tree as the running node binary (when we are on real Node, not Electron)
  const nodeDir = dirname(execPath);
  if (!/electron/i.test(execPath)) {
    candidates.push(
      join(nodeDir, "npm"),
      join(nodeDir, "npm.cmd"),
      join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    );
  }

  // npm_config_user_agent / npm_node_execpath from parent npm scripts
  if (env.npm_node_execpath) {
    const d = dirname(env.npm_node_execpath);
    candidates.push(join(d, "npm"), join(d, "npm.cmd"));
  }

  const home = homedir();
  candidates.push(
    // Homebrew
    "/opt/homebrew/bin/npm",
    "/usr/local/bin/npm",
    // Common version managers / custom installs
    join(home, ".local", "bin", "npm"),
    join(home, ".hermes", "node", "bin", "npm"),
    join(home, ".nvm", "current", "bin", "npm"),
    join(home, ".fnm", "current", "bin", "npm"),
    join(home, ".volta", "bin", "npm"),
    join(home, ".asdf", "shims", "npm"),
    // System
    "/usr/bin/npm",
  );

  // PATH walk
  const pathEnv = env.PATH ?? env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    candidates.push(join(dir, "npm"), join(dir, "npm.cmd"));
  }

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }

  // Last resort: ask the login shell (slow, but covers nvm lazy loads)
  try {
    const shell = env.SHELL || (platform === "win32" ? null : "/bin/zsh");
    if (shell) {
      const out = execFileSync(shell, ["-lc", "command -v npm || which npm"], {
        encoding: "utf8",
        timeout: 4000,
        env: env as NodeJS.ProcessEnv,
      }).trim();
      const line = out.split("\n").map((s) => s.trim()).find((s) => s && !s.includes("not found"));
      if (line && existsSync(line)) return line;
    }
  } catch {
    // ignore
  }

  return null;
}

/** Ensure PATH contains the directory of a resolved npm (and node if nearby). */
export function ensureNpmOnPath(): string | null {
  const npm = resolveNpmBinary();
  if (!npm) return null;

  const dir = dirname(npm);
  const pathKey = platform === "win32" ? "Path" : "PATH";
  const current = env[pathKey] ?? "";
  const parts = current.split(delimiter).filter(Boolean);
  if (!parts.includes(dir)) {
    env[pathKey] = `${dir}${delimiter}${current}`;
  }

  // npm is often a script that needs `node` next to it
  for (const nodeName of platform === "win32" ? ["node.exe", "node"] : ["node"]) {
    const nodePath = join(dir, nodeName);
    if (existsSync(nodePath) && !parts.includes(dir)) {
      // already prepended above
      break;
    }
  }

  return npm;
}

/**
 * Prefer absolute npm for pi's settings `npmCommand` so package install works even
 * when child spawns inherit a minimal PATH.
 */
export function getNpmCommandForPi(): string[] | null {
  const npm = ensureNpmOnPath();
  if (!npm) return null;

  // If we found npm-cli.js, invoke via node next to it (or process.execPath when real node).
  if (npm.endsWith("npm-cli.js")) {
    const nodeNear = join(dirname(npm), "..", "..", "..", "bin", "node");
    const node =
      (existsSync(nodeNear) && nodeNear) ||
      (env.npm_node_execpath && existsSync(env.npm_node_execpath) && env.npm_node_execpath) ||
      (!/electron/i.test(execPath) ? execPath : null);
    if (node) return [node, npm];
  }

  return [npm];
}
