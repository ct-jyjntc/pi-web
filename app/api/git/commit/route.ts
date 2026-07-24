import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { commitGitChanges } from "@/lib/git-changes";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; message?: string };
    const cwd = body.cwd?.trim() ?? "";
    const message = body.message?.trim() ?? "";

    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    try {
      const stat = fs.statSync(cwd);
      if (!stat.isDirectory()) {
        return NextResponse.json({ error: "Not a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    const result = await commitGitChanges(cwd, message);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
