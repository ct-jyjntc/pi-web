import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
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
    const cwd = body.cwd?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    try {
      fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    const mode = body.mode === "ai" ? "ai" : "heuristic";
    const includeUnstaged = body.includeUnstaged === true;
    const draft = mode === "ai"
      ? await draftCommitMessageWithAi(cwd, { includeUnstaged })
      : await draftCommitMessageHeuristic(cwd, { includeUnstaged });

    return NextResponse.json({
      ok: true,
      message: draft.message,
      source: draft.source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
