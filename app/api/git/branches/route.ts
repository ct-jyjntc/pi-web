import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { checkoutGitBranch, createGitBranch, listGitBranches } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const allowed = await assertAllowedCwd(request.nextUrl.searchParams.get("cwd"));
    if (isCwdDenied(allowed)) return allowed;
    return NextResponse.json(await listGitBranches(allowed.cwd));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      action?: "checkout" | "create";
      branch?: string;
    };
    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    const branch = body.branch?.trim() ?? "";
    if (!branch) {
      return NextResponse.json({ error: "branch required" }, { status: 400 });
    }

    if (body.action === "create") {
      const status = await createGitBranch(allowed.cwd, branch, true);
      return NextResponse.json({ ok: true, status });
    }

    const status = await checkoutGitBranch(allowed.cwd, branch);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return jsonError(error);
  }
}
