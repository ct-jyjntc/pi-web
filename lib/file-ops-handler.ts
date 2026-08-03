/**
 * HTTP adapter for explorer file mutations.
 * Owns request parsing + allow-list checks; delegates FS work to lib/file-ops.ts.
 */
import { promises as fsp } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  fileAccessDenied,
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
} from "@/lib/file-access";
import { resolveRealRoots } from "@/lib/path-security";
import {
  copyEntry,
  createDirectory,
  createEmptyFile,
  deleteEntry,
  fileOpErrorStatus,
  isPathInsideOrEqual,
  joinUnderParent,
  moveEntry,
  parseFileOpType,
  renameEntry,
  type FileOpType,
  validateEntryName,
} from "@/lib/file-ops";

async function authorizeExisting(
  target: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<{ realPath: string } | NextResponse> {
  if (!isFilePathAllowed(target, allowedRoots)) {
    return NextResponse.json(fileAccessDenied(target, allowedRoots, "not_in_roots"), { status: 403 });
  }
  if (!isExistingFilePathAllowed(target, allowedRoots)) {
    return NextResponse.json(fileAccessDenied(target, allowedRoots, "existing_path_escape"), { status: 403 });
  }
  let realPath: string;
  try {
    realPath = await fsp.realpath(target);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isFilePathAllowed(realPath, resolveRealRoots(allowedRoots))) {
    return NextResponse.json(fileAccessDenied(realPath, allowedRoots, "realpath_escape"), { status: 403 });
  }
  return { realPath };
}

async function authorizeParentDirectory(
  parentPath: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<{ realParent: string } | NextResponse> {
  const authorized = await authorizeExisting(parentPath, allowedRoots);
  if (authorized instanceof NextResponse) return authorized;
  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(authorized.realPath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: "Parent is not a directory" }, { status: 400 });
  }
  return { realParent: authorized.realPath };
}

function authorizeDestinationPath(
  destPath: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): NextResponse | null {
  if (!isFilePathAllowed(destPath, allowedRoots)) {
    return NextResponse.json(fileAccessDenied(destPath, allowedRoots, "not_in_roots"), { status: 403 });
  }
  return null;
}

function protectedRootResponse(): NextResponse {
  return NextResponse.json({ error: "Cannot modify an allowed project root" }, { status: 400 });
}

function isProtectedRoot(
  realPath: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): boolean {
  const realRoots = resolveRealRoots(allowedRoots);
  for (const root of realRoots) {
    if (isPathInsideOrEqual(root, realPath) && isPathInsideOrEqual(realPath, root)) return true;
  }
  // Also protect the unresolved root strings (cwd may match before realpath).
  for (const root of allowedRoots) {
    if (isPathInsideOrEqual(root, realPath) && isPathInsideOrEqual(realPath, root)) return true;
  }
  return false;
}

async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  return (await request.json().catch(() => null)) as Record<string, unknown> | null;
}

function nameFromBody(body: Record<string, unknown> | null): string | null {
  return typeof body?.name === "string" ? body.name : null;
}

function destinationFromBody(body: Record<string, unknown> | null): string | null {
  return typeof body?.destination === "string" ? body.destination : null;
}

async function runCreateOp(
  type: "mkdir" | "create",
  parentPath: string,
  name: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<NextResponse> {
  const nameError = validateEntryName(name);
  if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

  const parent = await authorizeParentDirectory(parentPath, allowedRoots);
  if (parent instanceof NextResponse) return parent;

  const destPath = joinUnderParent(parent.realParent, name);
  const destDenied = authorizeDestinationPath(destPath, allowedRoots);
  if (destDenied) return destDenied;

  try {
    const created = type === "mkdir"
      ? await createDirectory(parent.realParent, name)
      : await createEmptyFile(parent.realParent, name);
    return NextResponse.json({ ok: true, path: created, name });
  } catch (error) {
    const { status, error: message } = fileOpErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}

async function runRenameOp(
  sourcePath: string,
  name: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<NextResponse> {
  const nameError = validateEntryName(name);
  if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

  const source = await authorizeExisting(sourcePath, allowedRoots);
  if (source instanceof NextResponse) return source;
  if (isProtectedRoot(source.realPath, allowedRoots)) return protectedRootResponse();

  const destPath = joinUnderParent(path.dirname(source.realPath), name);
  const destDenied = authorizeDestinationPath(destPath, allowedRoots);
  if (destDenied) return destDenied;

  try {
    const renamed = await renameEntry(source.realPath, name);
    return NextResponse.json({ ok: true, path: renamed, name });
  } catch (error) {
    const { status, error: message } = fileOpErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}

async function runDeleteOp(
  targetPath: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<NextResponse> {
  const target = await authorizeExisting(targetPath, allowedRoots);
  if (target instanceof NextResponse) return target;
  if (isProtectedRoot(target.realPath, allowedRoots)) return protectedRootResponse();

  try {
    await deleteEntry(target.realPath);
    return NextResponse.json({ ok: true, path: target.realPath });
  } catch (error) {
    const { status, error: message } = fileOpErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}

async function runTransferOp(
  type: "copy" | "move",
  sourcePath: string,
  destinationPath: string,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<NextResponse> {
  const source = await authorizeExisting(sourcePath, allowedRoots);
  if (source instanceof NextResponse) return source;
  if (type === "move" && isProtectedRoot(source.realPath, allowedRoots)) return protectedRootResponse();

  const destDenied = authorizeDestinationPath(destinationPath, allowedRoots);
  if (destDenied) return destDenied;

  // Parent of destination must exist and be writable under roots.
  const destParent = path.dirname(destinationPath);
  const parent = await authorizeParentDirectory(destParent, allowedRoots);
  if (parent instanceof NextResponse) return parent;

  // Rebuild destination under the authorized real parent + basename so a
  // symlink parent cannot redirect the write outside the root.
  const safeDest = path.join(parent.realParent, path.basename(destinationPath));
  const safeDestDenied = authorizeDestinationPath(safeDest, allowedRoots);
  if (safeDestDenied) return safeDestDenied;

  try {
    if (type === "copy") await copyEntry(source.realPath, safeDest);
    else await moveEntry(source.realPath, safeDest);
    return NextResponse.json({ ok: true, path: safeDest });
  } catch (error) {
    const { status, error: message } = fileOpErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Handle explorer mutation POST types. Returns null when `type` is not a file op
 * so the route can fall through to upload / save handlers.
 */
export async function tryHandleFileOp(
  request: NextRequest,
  filePath: string,
  typeParam: string | null,
): Promise<NextResponse | null> {
  const type = parseFileOpType(typeParam);
  if (!type) return null;

  const allowedRoots = await getAllowedFileRoots();
  return executeFileOp(type, filePath, request, allowedRoots);
}

async function executeFileOp(
  type: FileOpType,
  filePath: string,
  request: NextRequest,
  allowedRoots: Awaited<ReturnType<typeof getAllowedFileRoots>>,
): Promise<NextResponse> {
  if (type === "delete") {
    return runDeleteOp(filePath, allowedRoots);
  }

  const body = await readJsonBody(request);

  if (type === "mkdir" || type === "create") {
    const name = nameFromBody(body);
    if (name == null) return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    return runCreateOp(type, filePath, name, allowedRoots);
  }

  if (type === "rename") {
    const name = nameFromBody(body);
    if (name == null) return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    return runRenameOp(filePath, name, allowedRoots);
  }

  // copy / move
  const destination = destinationFromBody(body);
  if (destination == null) {
    return NextResponse.json({ error: "destination must be a string" }, { status: 400 });
  }
  return runTransferOp(type, filePath, destination, allowedRoots);
}
