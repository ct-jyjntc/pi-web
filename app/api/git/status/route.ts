import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const allowed = await assertAllowedCwd(params.get("cwd"));
    if (isCwdDenied(allowed)) return allowed;

    const allowCached = params.get("fresh") !== "1";
    return NextResponse.json(await getGitStatus(allowed.cwd, { allowCached }));
  } catch (error) {
    return jsonError(error);
  }
}
