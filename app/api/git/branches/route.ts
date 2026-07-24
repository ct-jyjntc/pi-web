import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { checkoutGitBranch, createGitBranch, listGitBranches } from "@/lib/git-changes";

async function assertCwd(cwd: string) {
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
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
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const denied = await assertCwd(cwd);
    if (denied) return denied;
    return NextResponse.json(await listGitBranches(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      action?: "checkout" | "create";
      branch?: string;
    };
    const cwd = body.cwd?.trim() ?? "";
    const denied = await assertCwd(cwd);
    if (denied) return denied;

    const branch = body.branch?.trim() ?? "";
    if (!branch) {
      return NextResponse.json({ error: "branch required" }, { status: 400 });
    }

    if (body.action === "create") {
      const status = await createGitBranch(cwd, branch, true);
      return NextResponse.json({ ok: true, status });
    }

    const status = await checkoutGitBranch(cwd, branch);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
