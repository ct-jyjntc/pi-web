import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const GITHUB_REPO = "ct-jyjntc/pi-web";
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

function packageJsonCandidates(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, "package.json"),
    // Electron / packaged standalone may nest the app under resources/standalone
    join(cwd, "standalone", "package.json"),
    join(cwd, "Resources", "standalone", "package.json"),
  ];
}

export function getAppVersion(): string {
  for (const path of packageJsonCandidates()) {
    try {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
      if (typeof raw.version === "string" && raw.version.trim()) {
        return raw.version.trim();
      }
    } catch {
      // try next candidate
    }
  }
  return "0.0.0";
}

/** Strip leading `v` and any pre-release/build metadata for numeric compare. */
export function normalizeVersion(version: string): number[] {
  const core = version.trim().replace(/^v/i, "").split(/[-+]/, 1)[0] ?? "0";
  return core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** -1 if a < b, 0 if equal, 1 if a > b */
export function compareVersions(a: string, b: string): number {
  const aa = normalizeVersion(a);
  const bb = normalizeVersion(b);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d < 0) return -1;
    if (d > 0) return 1;
  }
  return 0;
}

export function isUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
  return compareVersions(latestVersion, currentVersion) > 0;
}
