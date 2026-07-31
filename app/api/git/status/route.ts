import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const allowed = await assertAllowedCwd(request.nextUrl.searchParams.get("cwd"));
    if (isCwdDenied(allowed)) return allowed;

    return NextResponse.json(await getGitStatus(allowed.cwd));
  } catch (error) {
    return jsonError(error);
  }
}
