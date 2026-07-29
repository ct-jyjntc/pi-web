import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";

function allowed(target: string, roots: Set<string>): boolean {
  return isExistingFilePathAllowed(target, roots) || isFilePathAllowed(target, roots);
}
import {
  draftConflictResolutionWithAi,
  getConflictFileDetail,
  resolveConflictContent,
  resolveConflictSide,
  type ConflictSide,
} from "@/lib/git-conflict";

export const dynamic = "force-dynamic";

function isAbs(p: string): boolean {
  return p.startsWith("/") || isWindowsAbsolutePath(p);
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
    if (!cwd || !isAbs(cwd)) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!filePath || !isAbs(filePath)) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!allowed(cwd, allowedRoots) || !allowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const detail = await getConflictFileDetail(cwd, filePath);
    return NextResponse.json({ ok: true, ...detail });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      path?: string;
      action?: string;
      content?: string;
    };
    const cwd = body.cwd?.trim() ?? "";
    const filePath = body.path?.trim() ?? "";
    const action = body.action?.trim() ?? "";

    if (!cwd || !isAbs(cwd)) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!filePath || !isAbs(filePath)) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }
    if (!["ours", "theirs", "base", "content", "ai"].includes(action)) {
      return NextResponse.json({ error: "action must be ours|theirs|base|content|ai" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!allowed(cwd, allowedRoots) || !allowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    try {
      fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    if (action === "ours" || action === "theirs" || action === "base") {
      const status = await resolveConflictSide(cwd, filePath, action as ConflictSide);
      return NextResponse.json({ ok: true, status });
    }

    if (action === "content") {
      if (typeof body.content !== "string") {
        return NextResponse.json({ error: "content is required" }, { status: 400 });
      }
      const status = await resolveConflictContent(cwd, filePath, body.content);
      return NextResponse.json({ ok: true, status });
    }

    // ai
    const result = await draftConflictResolutionWithAi(cwd, filePath);
    return NextResponse.json({
      ok: true,
      status: result.status,
      content: result.content,
      explanation: result.explanation,
      source: "ai",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
