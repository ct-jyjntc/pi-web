import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { commitGitChanges } from "@/lib/git-changes";
import { getGitCommitDetail } from "@/lib/git-history";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd") ?? undefined;
    const sha = request.nextUrl.searchParams.get("sha") ?? "";
    const allowed = await assertAllowedCwd(cwd);
    if (isCwdDenied(allowed)) return allowed;
    if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
      return NextResponse.json({ error: "invalid sha" }, { status: 400 });
    }

    const detail = await getGitCommitDetail(allowed.cwd, sha);
    return NextResponse.json({ ok: true, commit: detail });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; message?: string };
    const message = body.message?.trim() ?? "";
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    const result = await commitGitChanges(allowed.cwd, message);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
