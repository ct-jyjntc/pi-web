import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, assertAllowedPaths, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { discardGitFiles } from "@/lib/git-changes";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; paths?: string[] };
    const paths = Array.isArray(body.paths) ? body.paths.map((p) => String(p).trim()).filter(Boolean) : [];
    if (paths.length === 0) {
      return NextResponse.json({ error: "paths required" }, { status: 400 });
    }

    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;
    const deniedPaths = assertAllowedPaths(paths, allowed.roots);
    if (deniedPaths) return deniedPaths;

    const status = await discardGitFiles(allowed.cwd, paths);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return jsonError(error);
  }
}
