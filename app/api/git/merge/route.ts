import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { completeMergeCommit, isMergeInProgress } from "@/lib/git-merge";

export const dynamic = "force-dynamic";

function allowed(target: string, roots: Set<string>): boolean {
  return isExistingFilePathAllowed(target, roots) || isFilePathAllowed(target, roots);
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!allowed(cwd, roots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const merging = await isMergeInProgress(cwd);
    return NextResponse.json({ ok: true, merging });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; message?: string };
    const cwd = body.cwd?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!allowed(cwd, roots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    try { fs.statSync(cwd); } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    const result = await completeMergeCommit(cwd, body.message);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
