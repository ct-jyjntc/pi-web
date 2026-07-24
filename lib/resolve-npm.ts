import { existsSync } from "fs";
import { delimiter, dirname, join } from "path";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { execPath, env, platform } from "process";

/** Locate a usable `npm` binary (GUI/Electron PATH is often incomplete). */
export function resolveNpmBinary(): string | null {
  if (env.PI_WEB_NPM && existsSync(env.PI_WEB_NPM)) return env.PI_WEB_NPM;

  const candidates: string[] = [];
  const nodeDir = dirname(execPath);
  if (!/electron/i.test(execPath)) {
    candidates.push(join(nodeDir, "npm"), join(nodeDir, "npm.cmd"));
  }
  if (env.npm_node_execpath) {
    const d = dirname(env.npm_node_execpath);
    candidates.push(join(d, "npm"), join(d, "npm.cmd"));
  }
  const home = homedir();
  candidates.push(
    "/opt/homebrew/bin/npm",
    "/usr/local/bin/npm",
    join(home, ".local", "bin", "npm"),
    join(home, ".hermes", "node", "bin", "npm"),
    join(home, ".nvm", "current", "bin", "npm"),
    join(home, ".fnm", "current", "bin", "npm"),
    join(home, ".volta", "bin", "npm"),
    join(home, ".asdf", "shims", "npm"),
    "/usr/bin/npm",
  );
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!dir) continue;
    candidates.push(join(dir, "npm"), join(dir, "npm.cmd"));
  }
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
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

export function ensureNpmOnPath(): string | null {
  const npm = resolveNpmBinary();
  if (!npm) return null;
  const dir = dirname(npm);
  const pathKey = platform === "win32" ? "Path" : "PATH";
  const current = env[pathKey] ?? "";
  const parts = current.split(delimiter).filter(Boolean);
  if (!parts.includes(dir)) env[pathKey] = `${dir}${delimiter}${current}`;
  return npm;
}

export function getNpmCommandForPi(): string[] | null {
  const npm = ensureNpmOnPath();
  if (!npm) return null;
  return [npm];
}
