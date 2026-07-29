import { NextRequest, NextResponse } from "next/server";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { runAdvisorReview } from "@/lib/advisor";
import { readWebSettings } from "@/lib/web-settings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      userText?: string;
      assistantText?: string;
      toolSummary?: string;
    };
    const cwd = body.cwd?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!readWebSettings().advisorEnabled) {
      return NextResponse.json({ ok: true, note: null, disabled: true });
    }
    const note = await runAdvisorReview(cwd, {
      userText: String(body.userText ?? ""),
      assistantText: String(body.assistantText ?? ""),
      toolSummary: body.toolSummary,
    });
    return NextResponse.json({ ok: true, note });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
