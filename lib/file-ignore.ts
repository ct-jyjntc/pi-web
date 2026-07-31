/** Shared skip lists for filesystem listing / indexing. */

export const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
  ".DS_Store",
]);

export const IGNORED_FILE_SUFFIXES = [".pyc"] as const;

export function isIgnoredDirentName(name: string): boolean {
  if (IGNORED_DIR_NAMES.has(name)) return true;
  return IGNORED_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
