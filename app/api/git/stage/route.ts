import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { stageGitFiles } from "@/lib/git-changes";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; paths?: string[] };
    const cwd = body.cwd?.trim() ?? "";
    const paths = Array.isArray(body.paths) ? body.paths.map((p) => String(p).trim()).filter(Boolean) : [];

    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (paths.length === 0) {
      return NextResponse.json({ error: "paths required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    for (const filePath of paths) {
      if (!filePath.startsWith("/") && !isWindowsAbsolutePath(filePath)) {
        return NextResponse.json({ error: "paths must be absolute" }, { status: 400 });
      }
      if (!isFilePathAllowed(filePath, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    try {
      fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    const status = await stageGitFiles(cwd, paths);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
