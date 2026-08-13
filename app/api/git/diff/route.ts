import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, assertAllowedPaths, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { isAbsolutePath } from "@/lib/path-utils";
import { getGitFileDiff } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const filePath = params.get("path")?.trim() ?? "";
    if (!filePath || !isAbsolutePath(filePath)) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }

    const allowed = await assertAllowedCwd(params.get("cwd"));
    if (isCwdDenied(allowed)) return allowed;
    const deniedPaths = assertAllowedPaths([filePath], allowed.roots);
    if (deniedPaths) return deniedPaths;

    const allowCached = params.get("fresh") !== "1";
    return NextResponse.json(await getGitFileDiff(allowed.cwd, filePath, { allowCached }));
  } catch (error) {
    return jsonError(error);
  }
}
