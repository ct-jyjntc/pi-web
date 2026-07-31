import { NextRequest, NextResponse } from "next/server";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { runMemoryReview } from "@/lib/memory-review";

export const dynamic = "force-dynamic";

// Like the advisor route, this awaits the review: the client fires it
// fire-and-forget after agent-end, so holding the request for the (60s-capped)
// utility-model call blocks nothing in the UI, and the response can report
// how many memories were actually saved.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      sessionId?: string;
    };
    const cwd = body.cwd?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    const sessionId = body.sessionId?.trim() ?? "";
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const result = await runMemoryReview({ cwd, sessionId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
