import { NextRequest, NextResponse } from "next/server";
import { assertAllowedCwd, isCwdDenied } from "@/lib/api-cwd";
import { jsonError } from "@/lib/api-response";
import {
  draftCommitMessageHeuristic,
  draftCommitMessageWithAi,
} from "@/lib/git-commit-message-ai";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      mode?: string;
      includeUnstaged?: boolean;
    };

    const allowed = await assertAllowedCwd(body.cwd);
    if (isCwdDenied(allowed)) return allowed;

    const mode = body.mode === "ai" ? "ai" : "heuristic";
    const includeUnstaged = body.includeUnstaged === true;
    const draft = mode === "ai"
      ? await draftCommitMessageWithAi(allowed.cwd, { includeUnstaged })
      : await draftCommitMessageHeuristic(allowed.cwd, { includeUnstaged });

    return NextResponse.json({
      ok: true,
      message: draft.message,
      source: draft.source,
    });
  } catch (error) {
    return jsonError(error);
  }
}
