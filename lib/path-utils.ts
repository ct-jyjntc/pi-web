/** Leaf path helpers shared by file-access, path-security, and API routes. */

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

/** Windows drive / UNC absolute path (also accepts forward-slash UNC). */
export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/** True for POSIX absolute or Windows absolute / UNC paths. */
export function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || isWindowsAbsolutePath(filePath);
}

/** Normalize path separators to `/` (simple, used by allow-list roots). */
export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** decodeURIComponent that returns the original string on failure. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
