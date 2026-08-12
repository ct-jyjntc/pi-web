import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { getGitStatus } from "@/lib/git-changes";
import { initGitRepository } from "@/lib/git-init";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string };
    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    await initGitRepository(allowed.cwd);
    return NextResponse.json({ ok: true, status: await getGitStatus(allowed.cwd) });
  } catch (error) {
    return jsonError(error);
  }
}
