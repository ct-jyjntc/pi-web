import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { completeMergeCommit, isMergeInProgress } from "@/lib/git-merge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const allowed = await assertAllowedCwd(request.nextUrl.searchParams.get("cwd"));
    if (isCwdDenied(allowed)) return allowed;
    const merging = await isMergeInProgress(allowed.cwd);
    return NextResponse.json({ ok: true, merging });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; message?: string };
    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;
    const result = await completeMergeCommit(allowed.cwd, body.message);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
