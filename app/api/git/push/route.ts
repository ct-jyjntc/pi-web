import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { pushGit } from "@/lib/git-changes";
import { getGithubAccountPublic } from "@/lib/accounts-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string };
    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    const result = await pushGit(allowed.cwd);
    const github = getGithubAccountPublic();
    return NextResponse.json({
      ok: true,
      ...result,
      // Lets the Git panel offer the publish dialog (or a sign-in prompt)
      // instead of failing when the repo has no remote.
      githubConnected: github.connected,
      githubLogin: github.login,
    });
  } catch (error) {
    return jsonError(error);
  }
}
