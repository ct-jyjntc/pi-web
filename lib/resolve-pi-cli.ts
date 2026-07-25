import { existsSync } from "fs";
import { delimiter, dirname, join } from "path";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { env, platform } from "process";

/**
 * Locate the real Pi CLI binary for child process spawns.
 * Inside Electron, process.execPath is the Electron helper — spawning it as
 * "node" crashes with "Unable to find helper app".
 */
export function resolvePiBinary(): string | null {
  if (env.PI_SUBAGENT_PI_BINARY && existsSync(env.PI_SUBAGENT_PI_BINARY)) {
    return env.PI_SUBAGENT_PI_BINARY;
  }
  if (env.PI_WEB_PI_BINARY && existsSync(env.PI_WEB_PI_BINARY)) {
    return env.PI_WEB_PI_BINARY;
  }

  // Packaged app: pi shim lives next to the bundled Node runtime.
  const home = homedir();
  const candidates: string[] = [];
  if (env.PI_WEB_NODE && existsSync(env.PI_WEB_NODE)) {
    candidates.push(join(dirname(env.PI_WEB_NODE), platform === "win32" ? "pi.cmd" : "pi"));
  }
  // When the Next server is started from standalone/, bin/pi is a sibling of node.
  candidates.push(
    join(process.cwd(), "bin", platform === "win32" ? "pi.cmd" : "pi"),
    join(process.cwd(), "..", "bin", platform === "win32" ? "pi.cmd" : "pi"),
  );
  candidates.push(
    "/opt/homebrew/bin/pi",
    "/usr/local/bin/pi",
    join(home, ".local", "bin", "pi"),
    join(home, ".hermes", "node", "bin", "pi"),
  );

  const pathEnv = env.PATH ?? env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    candidates.push(join(dir, "pi"), join(dir, "pi.cmd"));
  }

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }

  try {
    const shell = env.SHELL || (platform === "win32" ? null : "/bin/zsh");
    if (shell) {
      const out = execFileSync(shell, ["-lc", "command -v pi || which pi"], {
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

export function resolveRealNodeBinary(): string | null {
  if (env.PI_WEB_NODE && existsSync(env.PI_WEB_NODE)) return env.PI_WEB_NODE;
  if (env.PI_WEB_BUNDLE_NODE_BINARY && existsSync(env.PI_WEB_BUNDLE_NODE_BINARY)) {
    return env.PI_WEB_BUNDLE_NODE_BINARY;
  }
  // Packaged standalone layout
  const bundled = join(process.cwd(), "bin", platform === "win32" ? "node.exe" : "node");
  if (existsSync(bundled)) return bundled;
  if (env.npm_node_execpath && existsSync(env.npm_node_execpath)) return env.npm_node_execpath;

  const home = homedir();
  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    join(home, ".local", "bin", "node"),
    join(home, ".hermes", "node", "bin", "node"),
  ];
  const pathEnv = env.PATH ?? env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    candidates.push(join(dir, "node"), join(dir, "node.exe"));
  }
  for (const c of candidates) {
    if (c && existsSync(c) && !/electron/i.test(c)) return c;
  }
  return null;
}

/**
 * Point optional plugins that spawn `pi` at a real CLI + ensure real node is on PATH.
 * Safe to call multiple times (idempotent env mutation).
 */
export function ensureSubagentSpawnEnv(): {
  piBinary: string | null;
  nodeBinary: string | null;
} {
  const piBinary = resolvePiBinary();
  const nodeBinary = resolveRealNodeBinary();

  if (piBinary) {
    env.PI_SUBAGENT_PI_BINARY = piBinary;
  }

  const pathKey = platform === "win32" ? "Path" : "PATH";
  const parts = (env[pathKey] ?? "").split(delimiter).filter(Boolean);
  const prepend: string[] = [];
  if (nodeBinary) prepend.push(dirname(nodeBinary));
  if (piBinary) prepend.push(dirname(piBinary));
  for (const dir of prepend.reverse()) {
    if (dir && !parts.includes(dir)) parts.unshift(dir);
  }
  env[pathKey] = parts.join(delimiter);

  return { piBinary, nodeBinary };
}
