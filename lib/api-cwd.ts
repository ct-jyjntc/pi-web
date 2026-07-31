import fs from "fs";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed } from "./file-access";
import { isAbsolutePath } from "./path-utils";
import { jsonMessage } from "./api-response";

export type AssertCwdOptions = {
  /** When true (default), require the path to exist and be a directory. */
  requireDirectory?: boolean;
  /** When true, only require the path to exist (any type). Overrides requireDirectory. */
  requireExistsOnly?: boolean;
};

export type AllowedCwd = {
  cwd: string;
  roots: Set<string>;
};

/** Type guard: assertAllowedCwd returned an error response. */
export function isCwdDenied(result: AllowedCwd | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Validate cwd is absolute, under the file allow-list, and (by default) an
 * existing directory. Returns either `{ cwd, roots }` or a ready NextResponse.
 */
export async function assertAllowedCwd(
  cwd: string | null | undefined,
  options: AssertCwdOptions = {},
): Promise<AllowedCwd | NextResponse> {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed || !isAbsolutePath(trimmed)) {
    return jsonMessage("cwd must be an absolute path", 400);
  }

  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(trimmed, roots)) {
    return jsonMessage("Access denied", 403);
  }

  const requireDirectory = options.requireDirectory !== false && !options.requireExistsOnly;
  const requireExists = requireDirectory || options.requireExistsOnly === true;

  if (requireExists) {
    try {
      const stat = fs.statSync(trimmed);
      if (requireDirectory && !stat.isDirectory()) {
        return jsonMessage("Not a directory", 400);
      }
    } catch {
      return jsonMessage("Directory not found", 404);
    }
  }

  return { cwd: trimmed, roots };
}

/** Validate absolute paths against an already-fetched allow-list. */
export function assertAllowedPaths(
  paths: string[],
  roots: Set<string>,
): NextResponse | null {
  for (const filePath of paths) {
    if (!isAbsolutePath(filePath)) {
      return jsonMessage("paths must be absolute", 400);
    }
    if (!isFilePathAllowed(filePath, roots)) {
      return jsonMessage("Access denied", 403);
    }
  }
  return null;
}
