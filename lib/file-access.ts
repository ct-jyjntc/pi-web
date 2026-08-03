import { readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots, resolveRealRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath, isAbsolutePath } from "./path-utils";

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

/** Why a files API request was rejected — single owner for 403 diagnostics. */
export type FileAccessDenyReason =
  | "not_in_roots"
  | "realpath_escape"
  | "existing_path_escape";

export type FileAccessDeniedBody = {
  error: "Access denied";
  path: string;
  reason: FileAccessDenyReason;
  rootCount: number;
  /** Capped sample so agents can see which roots were considered without dumping hundreds. */
  rootsSample: string[];
  hint: string;
};

const ROOTS_SAMPLE_MAX = 12;

/**
 * Structured 403 payload for /api/files. Agents previously only saw
 * `{"error":"Access denied"}` and guessed with curl; this names the path,
 * reason, and a sample of allowed roots.
 */
export function fileAccessDenied(
  target: string,
  allowedRoots: Set<string>,
  reason: FileAccessDenyReason = "not_in_roots",
): FileAccessDeniedBody {
  const roots = [...allowedRoots].map(normalizeSlashes).sort();
  const rootCount = roots.length;
  const rootsSample = roots.slice(0, ROOTS_SAMPLE_MAX);
  const pathNorm = normalizeSlashes(target);
  let hint: string;
  if (rootCount === 0) {
    hint =
      "No allowed roots loaded. Open a session whose cwd is this project, or POST /api/cwd/validate with { \"cwd\": \"<abs>\" } to register a root.";
  } else if (reason === "realpath_escape" || reason === "existing_path_escape") {
    hint =
      "Path resolves (realpath) outside allowed roots — possible symlink escape. Use a real path under one of the rootsSample entries.";
  } else if (!pathNorm.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(pathNorm)) {
    hint =
      "Path is not absolute. /api/files expects absolute path segments (e.g. /api/files/Users/you/proj/file.ts), not a project-relative name.";
  } else {
    hint =
      "Path is not under any allowed root (session cwd, projectRoot, ~/pi-cwd-*, or allowFileRoot). Pick a file inside rootsSample or register the project via cwd/validate.";
  }
  return {
    error: "Access denied",
    path: pathNorm,
    reason,
    rootCount,
    rootsSample,
    hint,
  };
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
