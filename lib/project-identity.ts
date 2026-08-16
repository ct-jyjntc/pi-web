/**
 * Stable comparison-only identity for project paths: Windows casing/separator
 * variants fold into one key so sessions group into a single sidebar project.
 * Display strings and filesystem operations always keep the raw cwd/projectRoot.
 *
 * Server-only: imported by session-reader and API routes. Client components
 * consume the computed `projectKey` fields — importing this module from the
 * renderer bundle pulls in `node:path`, which Next.js webpack cannot build.
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
  platform: NodeJS.Platform = process.platform,
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
