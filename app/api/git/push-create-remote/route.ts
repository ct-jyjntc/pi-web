import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { publishToGithub } from "@/lib/git-remote";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      name?: string;
      visibility?: "private" | "public";
    };
    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    if (body.visibility !== "private" && body.visibility !== "public") {
      return NextResponse.json({ error: "visibility must be 'private' or 'public'" }, { status: 400 });
    }

    const result = await publishToGithub(allowed.cwd, body.name ?? "", body.visibility);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
