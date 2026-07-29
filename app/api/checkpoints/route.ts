import { NextRequest, NextResponse } from "next/server";
import { createCheckpoint, getCheckpoint, listCheckpoints } from "@/lib/session-checkpoint";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    return NextResponse.json({ ok: true, checkpoints: listCheckpoints(sessionId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      sessionId?: string;
      name?: string;
      summary?: string;
      entryId?: string;
      action?: string;
      checkpointId?: string;
    };
    const sessionId = body.sessionId?.trim() ?? "";
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    if (body.action === "get") {
      const cp = getCheckpoint(sessionId, String(body.checkpointId ?? body.name ?? ""));
      if (!cp) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
      return NextResponse.json({ ok: true, checkpoint: cp });
    }

    const cp = createCheckpoint(sessionId, {
      name: body.name ?? "checkpoint",
      summary: body.summary,
      entryId: body.entryId,
    });
    return NextResponse.json({ ok: true, checkpoint: cp });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
