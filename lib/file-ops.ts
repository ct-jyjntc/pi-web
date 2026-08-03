/**
 * Server-side file-tree mutations for the explorer (create / rename / delete / copy / move).
 * Single owner for entry-name validation and filesystem ops; the route owns allow-list auth.
 */
import { promises as fsp } from "fs";
import path from "path";

export const FILE_OP_TYPES = ["mkdir", "create", "rename", "delete", "copy", "move"] as const;
export type FileOpType = (typeof FILE_OP_TYPES)[number];

const FILE_OP_TYPE_SET = new Set<string>(FILE_OP_TYPES);

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function parseFileOpType(value: string | null): FileOpType | null {
  if (!value) return null;
  return FILE_OP_TYPE_SET.has(value) ? (value as FileOpType) : null;
}

/** Validate a single path segment used as a new file/folder name. */
export function validateEntryName(name: string): string | null {
  if (typeof name !== "string") return "Name must be a string";
  if (!name) return "Name must not be empty";
  if (name !== name.trim()) return "Name must not start or end with spaces";
  if (name === "." || name === ".." || name.includes("\0")) return `Invalid name: ${name}`;
  if (name.includes("/") || name.includes("\\") || path.basename(name) !== name) {
    return `Name must not contain a path: ${name}`;
  }
  if (name.length > 255) return "Name too long (max 255 characters)";
  return null;
}

export function joinUnderParent(parentDir: string, name: string): string {
  return path.join(parentDir, name);
}

/** True when `child` is `parent` or nested under it (after normalize). */
export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const useWin = process.platform === "win32";
  const resolver = useWin ? path.win32 : path;
  const normalizedParent = resolver.resolve(parent);
  const normalizedChild = resolver.resolve(child);
  const rel = resolver.relative(normalizedParent, normalizedChild);
  if (rel === "") return true;
  if (resolver.isAbsolute(rel)) return false;
  return !rel.startsWith("..");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function createEmptyFile(parentDir: string, name: string): Promise<string> {
  const dest = path.join(parentDir, name);
  // "wx" is atomic create — never overwrite an existing entry.
  await fsp.writeFile(dest, "", { flag: "wx" });
  return dest;
}

export async function createDirectory(parentDir: string, name: string): Promise<string> {
  const dest = path.join(parentDir, name);
  await fsp.mkdir(dest, { recursive: false });
  return dest;
}

export async function renameEntry(sourcePath: string, newName: string): Promise<string> {
  const dest = path.join(path.dirname(sourcePath), newName);
  if (normalizeSlashes(dest) === normalizeSlashes(sourcePath)) return sourcePath;
  if (await pathExists(dest)) {
    const err = new Error("Target already exists") as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }
  await fsp.rename(sourcePath, dest);
  return dest;
}

export async function deleteEntry(targetPath: string): Promise<void> {
  // recursive: directories; force:false so missing paths surface as ENOENT
  await fsp.rm(targetPath, { recursive: true, force: false });
}

export async function copyEntry(sourcePath: string, destPath: string): Promise<void> {
  if (isPathInsideOrEqual(sourcePath, destPath)) {
    throw Object.assign(new Error("Cannot copy a directory into itself"), { code: "EINVAL" });
  }
  if (await pathExists(destPath)) {
    const err = new Error("Target already exists") as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }
  await fsp.cp(sourcePath, destPath, { recursive: true, errorOnExist: true, force: false });
}

export async function moveEntry(sourcePath: string, destPath: string): Promise<void> {
  if (normalizeSlashes(sourcePath) === normalizeSlashes(destPath)) return;
  if (isPathInsideOrEqual(sourcePath, destPath)) {
    throw Object.assign(new Error("Cannot move a directory into itself"), { code: "EINVAL" });
  }
  if (await pathExists(destPath)) {
    const err = new Error("Target already exists") as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }
  try {
    await fsp.rename(sourcePath, destPath);
  } catch (error) {
    // Cross-device rename is not supported — fall back to copy + delete.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fsp.cp(sourcePath, destPath, { recursive: true, errorOnExist: true, force: false });
    await fsp.rm(sourcePath, { recursive: true, force: false });
  }
}

export function fileOpErrorStatus(error: unknown): { status: number; error: string } {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ENOENT") return { status: 404, error: "Not found" };
  if (code === "EEXIST") return { status: 409, error: "Target already exists" };
  if (code === "EINVAL") return { status: 400, error: message };
  if (code === "EACCES" || code === "EPERM") return { status: 403, error: message };
  return { status: 500, error: message };
}
