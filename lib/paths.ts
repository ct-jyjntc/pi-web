/**
 * Cross-platform path identity. Windows must treat `C:\A` and `c:/a` as one path.
 */
import path from "path";

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = toPosixPath(a).replace(/\/+$/, "");
  const right = toPosixPath(b).replace(/\/+$/, "");
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

export function toNativePath(p: string): string {
  if (process.platform === "win32") return p.replace(/\//g, path.win32.sep);
  return p;
}
