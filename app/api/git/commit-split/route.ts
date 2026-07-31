import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, assertAllowedPaths, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import { executeAtomicCommits, planAtomicCommits } from "@/lib/git-commit-split";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      mode?: string;
      includeUnstaged?: boolean;
      preferAi?: boolean;
      groups?: Array<{ message?: string; paths?: string[] }>;
    };
    const mode = body.mode?.trim() || "plan";

    if (mode !== "plan" && mode !== "execute") {
      return NextResponse.json({ error: "mode must be plan|execute" }, { status: 400 });
    }

    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    if (mode === "plan") {
      const plan = await planAtomicCommits(allowed.cwd, {
        includeUnstaged: body.includeUnstaged !== false,
        preferAi: body.preferAi !== false,
      });
      return NextResponse.json({ ok: true, ...plan });
    }

    const groups = Array.isArray(body.groups) ? body.groups : [];
    const allPaths = groups.flatMap((g) => (g.paths ?? []).map((p) => String(p).trim()).filter(Boolean));
    const deniedPaths = assertAllowedPaths(allPaths, allowed.roots);
    if (deniedPaths) return deniedPaths;

    const result = await executeAtomicCommits(
      allowed.cwd,
      groups.map((g) => ({
        message: String(g.message ?? ""),
        paths: (g.paths ?? []).map(String),
      })),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
