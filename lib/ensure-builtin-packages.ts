import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ensureNpmOnPath, getNpmCommandForPi, resolveNpmBinary } from "./resolve-npm";

const execFileAsync = promisify(execFile);

/**
 * First-party packages shipped with pi-web (auto-installed into ~/.pi/agent).
 * Only packages that provide real value in the web/Electron UI (not TUI-only).
 */
export const BUILTIN_PACKAGE_SOURCES = [
  "npm:@gotgenes/pi-permission-system",
  "npm:@gotgenes/pi-subagents",
  "npm:@juicesharp/rpiv-ask-user-question",
  "npm:@juicesharp/rpiv-todo",
  "npm:@lll9p/pi-better-compaction",
] as const;

/** Previously bundled packages that are TUI-centric / redundant in pi-web. */
export const PRUNE_PACKAGE_SOURCES = [
  "npm:pi-btw",
  "npm:pi-markdown-preview",
  "npm:pi-simplify",
  "npm:pi-tool-display",
  "npm:pi-rtk-optimizer",
] as const;

let ensurePromise: Promise<{ installed: string[]; notes: string[] }> | null = null;

function sourceToPackageName(source: string): string {
  let s = source.trim();
  if (s.startsWith("npm:")) s = s.slice(4);
  if (s.startsWith("@")) {
    const m = s.match(/^(@[^/]+\/[^@]+)/);
    return m?.[1] ?? s;
  }
  const at = s.lastIndexOf("@");
  return at > 0 ? s.slice(0, at) : s;
}

function packageConfigured(settingsManager: SettingsManager, source: string): boolean {
  const all = [
    ...(settingsManager.getGlobalSettings().packages ?? []),
    ...(settingsManager.getProjectSettings().packages ?? []),
  ];
  const name = sourceToPackageName(source);
  return all.some((entry) => {
    const s = typeof entry === "string" ? entry : entry.source;
    return s === source || s === name || s === `npm:${name}` || s.startsWith(`npm:${name}@`);
  });
}

function packageOnDisk(source: string): boolean {
  const name = sourceToPackageName(source);
  return existsSync(join(getAgentDir(), "npm", "node_modules", ...name.split("/"), "package.json"));
}

async function installPeers(packageName: string): Promise<string | null> {
  const installRoot = join(getAgentDir(), "npm");
  const pkgJson = join(installRoot, "node_modules", ...packageName.split("/"), "package.json");
  if (!existsSync(pkgJson)) return null;
  let peers: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { peerDependencies?: Record<string, string> };
    peers = Object.keys(pkg.peerDependencies ?? {});
  } catch {
    return null;
  }
  const missing = peers.filter((peer) => {
    return !existsSync(join(installRoot, "node_modules", ...peer.split("/"), "package.json"));
  });
  if (missing.length === 0) return null;
  const npm = resolveNpmBinary();
  if (!npm) return `Missing peers for ${packageName}: ${missing.join(", ")} (npm not found)`;
  await execFileAsync(npm, ["install", ...missing, "--prefix", installRoot, "--legacy-peer-deps"], {
    timeout: 240_000,
    env: process.env,
  });
  return `Peers for ${packageName}: ${missing.join(", ")}`;
}

/**
 * Install and register the pi-web built-in extension packages.
 * Idempotent; safe on every boot.
 */
export function ensureBuiltinPackages(): Promise<{ installed: string[]; notes: string[] }> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const installed: string[] = [];
    const notes: string[] = [];
    try {
      ensureNpmOnPath();
      if (!resolveNpmBinary()) {
        notes.push("npm not found — skip builtin package install");
        return { installed, notes };
      }
      const cwd = process.cwd();
      const settingsManager = SettingsManager.create(cwd, getAgentDir());
      if (!settingsManager.getNpmCommand()?.length) {
        const cmd = getNpmCommandForPi();
        if (cmd) settingsManager.setNpmCommand(cmd);
      }
      const packageManager = new DefaultPackageManager({
        cwd,
        agentDir: getAgentDir(),
        settingsManager,
      });

      // Drop TUI-only packages we no longer ship (best-effort).
      for (const source of PRUNE_PACKAGE_SOURCES) {
        if (!packageConfigured(settingsManager, source) && !packageOnDisk(source)) continue;
        try {
          await packageManager.removeAndPersist(source, { local: false });
          notes.push(`Pruned ${source}`);
        } catch (e) {
          notes.push(`Prune failed ${source}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      for (const source of BUILTIN_PACKAGE_SOURCES) {
        const name = sourceToPackageName(source);
        const needInstall = !packageConfigured(settingsManager, source) || !packageOnDisk(source);
        if (needInstall) {
          await packageManager.installAndPersist(source, { local: false });
          installed.push(source);
          notes.push(`Installed ${source}`);
        } else {
          notes.push(`Present ${source}`);
        }
        try {
          const peerNote = await installPeers(name);
          if (peerNote) notes.push(peerNote);
        } catch (e) {
          notes.push(`Peer install failed for ${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (error) {
      notes.push(`ensureBuiltinPackages failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error("[pi-web]", notes[notes.length - 1]);
    }
    return { installed, notes };
  })();
  return ensurePromise;
}
