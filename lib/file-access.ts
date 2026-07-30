import { readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots, resolveRealRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  // realpath()-resolved mirror of the allowed-roots set, memoized for the same
  // window. Kept in a separate global because lib/allowed-roots.ts declares (and
  // mutates) __piAllowedRootsCache.
  var __piAllowedRealRootsCache:
    | { roots: Set<string>; rootCount: number; realRoots: Set<string>; expiresAt: number }
    | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    // The project root (main repo shared by all worktrees) is browsable too —
    // the project dropdown lists it even when only worktrees have sessions.
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint.
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(normalizeSlashes(path.join(homedir(), name)));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/**
 * realpath()-resolved roots for `allowedRoots`, memoized for the same window as
 * the roots set itself (13 roots here → 13 realpathSync per file request without
 * this). Only reused for the exact set object it was derived from, and only while
 * that set still has the same size — allowFileRoot() adds to the cached set in
 * place, and a newly allowed root must not be authorized against stale reals.
 */
function getRealAllowedRoots(allowedRoots: Set<string>): Set<string> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRealRootsCache;
  if (
    cached &&
    cached.roots === allowedRoots &&
    cached.rootCount === allowedRoots.size &&
    cached.expiresAt > now
  ) {
    return cached.realRoots;
  }

  const realRoots = resolveRealRoots(allowedRoots);
  globalThis.__piAllowedRealRootsCache = {
    roots: allowedRoots,
    rootCount: allowedRoots.size,
    realRoots,
    expiresAt: now + ALLOWED_ROOTS_TTL_MS,
  };
  return realRoots;
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots, getRealAllowedRoots(allowedRoots));
}
