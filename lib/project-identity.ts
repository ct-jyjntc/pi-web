/**
 * Stable comparison-only identity for project paths: Windows casing/separator
 * variants fold into one key so sessions group into a single sidebar project.
 * Display strings and filesystem operations always keep the raw cwd/projectRoot.
 */
import path from "node:path";

/**
 * Stable, internal identity for a project path.
 *
 * Keep the original cwd/projectRoot for display and filesystem operations.
 * This key is only for grouping and equality: Windows paths are normalized
 * with win32 rules and case-folded because the default Windows filesystem is
 * case-insensitive. The explicit platform argument keeps those semantics
 * testable on non-Windows CI.
 */
export function projectIdentityKey(
  projectRoot: string,
  platform: NodeJS.Platform = runtimePlatform(),
): string {
  if (!projectRoot) return projectRoot;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const normalized = pathApi.normalize(projectRoot);
  const rootLength = pathApi.parse(normalized).root.length;
  let end = normalized.length;
  while (end > rootLength && normalized[end - 1] === pathApi.sep) end--;
  const withoutTrailingSeparators = normalized.slice(0, end);
  return platform === "win32"
    ? withoutTrailingSeparators.toLowerCase()
    : withoutTrailingSeparators;
}

/** Best-effort platform detection: the Next.js client shim leaves
 *  process.platform undefined, so the Electron renderer falls back to the
 *  preload bridge; anything unknown keeps posix (case-sensitive) semantics. */
export function runtimePlatform(): NodeJS.Platform {
  if (typeof process !== "undefined" && process.platform) return process.platform;
  if (typeof window !== "undefined" && window.piDesktop?.platform) {
    return window.piDesktop.platform as NodeJS.Platform;
  }
  return "linux";
}

/** Identity of a session-like object: the server-computed key when present,
 *  otherwise derived from projectRoot/cwd so legacy rows still fold into the
 *  same project as their keyed counterparts. */
export function sessionProjectKey(session: {
  cwd: string;
  projectRoot?: string | null;
  projectKey?: string | null;
}): string {
  return session.projectKey ?? projectIdentityKey(session.projectRoot ?? session.cwd);
}
