import { NextRequest, NextResponse } from "next/server";
import { createCollabShare, getCollabShare } from "@/lib/collab-live";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      sessionId?: string;
      sessionFile?: string;
      note?: string;
    };
    const sessionId = body.sessionId?.trim() ?? "";
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const share = createCollabShare({
      sessionId,
      sessionFile: body.sessionFile,
      note: body.note,
    });
    const origin = request.nextUrl.origin;
    return NextResponse.json({
      ok: true,
      share,
      watchUrl: `${origin}/api/collab/${share.token}`,
      eventsUrl: `${origin}/api/collab/${share.token}/events`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
    const share = getCollabShare(token);
    if (!share) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, share });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
