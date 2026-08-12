import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { getGitCommitDiff } from "@/lib/git-history";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd") ?? undefined;
    const sha = request.nextUrl.searchParams.get("sha") ?? "";
    const filePath = request.nextUrl.searchParams.get("path") ?? undefined;
    const allowed = await assertAllowedCwd(cwd);
    if (isCwdDenied(allowed)) return allowed;
    if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
      return NextResponse.json({ error: "invalid sha" }, { status: 400 });
    }

    const result = await getGitCommitDiff(allowed.cwd, sha, filePath);
    if (result.patch === null) {
      return NextResponse.json({ ok: false, error: "No diff available for this commit" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, patch: result.patch });
  } catch (error) {
    return jsonError(error);
  }
}
