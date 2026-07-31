import { NextRequest, NextResponse } from "next/server";
import { resolve } from "path";
import { jsonError } from "@/lib/api-response";
import { isAbsolutePath } from "@/lib/path-utils";
import { buildGitReviewContext } from "@/lib/git-review";

export const dynamic = "force-dynamic";

function pickCwd(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const cwd = raw.trim();
  if (!isAbsolutePath(cwd)) return null;
  return resolve(cwd);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      cwd?: string;
      includeUnstaged?: boolean;
    };
    const cwd = pickCwd(body.cwd);
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const context = await buildGitReviewContext(cwd, {
      includeUnstaged: body.includeUnstaged !== false,
    });

    if (!context.hasChanges) {
      return NextResponse.json({ error: "No changes to review", hasChanges: false }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      hasChanges: true,
      prompt: context.prompt,
      fileCount: context.fileCount,
      branch: context.branch,
      sessionName: context.sessionName,
      suggestedModel: context.suggestedModel,
    });
  } catch (error) {
    return jsonError(error);
  }
}
