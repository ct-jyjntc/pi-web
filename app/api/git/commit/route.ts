import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { commitGitChanges } from "@/lib/git-changes";

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
