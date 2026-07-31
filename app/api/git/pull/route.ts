import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { pullGit } from "@/lib/git-changes";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string };
    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    const result = await pullGit(allowed.cwd);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
