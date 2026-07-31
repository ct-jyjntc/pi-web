import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, assertAllowedPaths, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { isAbsolutePath } from "@/lib/path-utils";
import {
  draftConflictResolutionWithAi,
  getConflictFileDetail,
  resolveConflictContent,
  resolveConflictSide,
  type ConflictSide,
} from "@/lib/git-conflict";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
    if (!filePath || !isAbsolutePath(filePath)) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }

    const allowed = await assertAllowedCwd(request.nextUrl.searchParams.get("cwd"));
    if (isCwdDenied(allowed)) return allowed;
    const deniedPaths = assertAllowedPaths([filePath], allowed.roots);
    if (deniedPaths) return deniedPaths;

    const detail = await getConflictFileDetail(allowed.cwd, filePath);
    return NextResponse.json({ ok: true, ...detail });
  } catch (error) {
    return jsonError(error);
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
    const filePath = body.path?.trim() ?? "";
    const action = body.action?.trim() ?? "";

    if (!filePath || !isAbsolutePath(filePath)) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }
    if (!["ours", "theirs", "base", "content", "ai"].includes(action)) {
      return NextResponse.json({ error: "action must be ours|theirs|base|content|ai" }, { status: 400 });
    }

    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;
    const deniedPaths = assertAllowedPaths([filePath], allowed.roots);
    if (deniedPaths) return deniedPaths;

    if (action === "ours" || action === "theirs" || action === "base") {
      const status = await resolveConflictSide(allowed.cwd, filePath, action as ConflictSide);
      return NextResponse.json({ ok: true, status });
    }

    if (action === "content") {
      if (typeof body.content !== "string") {
        return NextResponse.json({ error: "content is required" }, { status: 400 });
      }
      const status = await resolveConflictContent(allowed.cwd, filePath, body.content);
      return NextResponse.json({ ok: true, status });
    }

    // ai
    const result = await draftConflictResolutionWithAi(allowed.cwd, filePath);
    return NextResponse.json({
      ok: true,
      status: result.status,
      content: result.content,
      explanation: result.explanation,
      source: "ai",
    });
  } catch (error) {
    return jsonError(error);
  }
}
