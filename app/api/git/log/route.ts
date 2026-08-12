import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { getGitLog } from "@/lib/git-history";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd") ?? undefined;
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const allowed = await assertAllowedCwd(cwd);
    if (isCwdDenied(allowed)) return allowed;

    const limit = Number.parseInt(limitRaw ?? "50", 10);
    const commits = await getGitLog(allowed.cwd, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50);
    return NextResponse.json({ ok: true, commits });
  } catch (error) {
    return jsonError(error);
  }
}
