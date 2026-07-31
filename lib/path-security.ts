import { realpathSync } from "fs";
import path from "path";
import { isWindowsAbsolutePath } from "./path-utils";

export function isPathWithinRoots(target: string, roots: Set<string>): boolean {
  for (const root of roots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) return true;
  }
  return false;
}

/** realpath() every root, dropping the ones that no longer resolve. */
export function resolveRealRoots(roots: Set<string>): Set<string> {
  const realRoots = new Set<string>();
  for (const root of roots) {
    try {
      realRoots.add(realpathSync(root));
    } catch {
      // Ignore stale roots derived from removed sessions or worktrees.
    }
  }
  return realRoots;
}

/**
 * Authorize an existing path with symlinks resolved on both sides.
 *
 * `realRoots` may be a precomputed resolveRealRoots(roots) result to avoid one
 * realpathSync per root on every request. The *target* is always resolved fresh,
 * so symlinks pointing out of an allowed root stay blocked.
 */
export function isExistingPathWithinRoots(
  target: string,
  roots: Set<string>,
  realRoots?: Set<string>,
): boolean {
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return false;
  }
  return isPathWithinRoots(realTarget, realRoots ?? resolveRealRoots(roots));
}
