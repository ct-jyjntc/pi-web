import { NextRequest, NextResponse } from "next/server";
import { getCollabShare, readSessionSnapshot } from "@/lib/collab-live";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const share = getCollabShare(token);
    if (!share) return NextResponse.json({ error: "not found" }, { status: 404 });
    const snap = share.sessionFile
      ? readSessionSnapshot(share.sessionFile)
      : { exists: false, size: 0, mtimeMs: 0, content: "", truncated: false, tail: "" };
    const lines = snap.content.split("\n").filter((l) => l.length > 0);
    return NextResponse.json({
      ok: true,
      share,
      snapshot: {
        exists: snap.exists,
        size: snap.size,
        mtimeMs: snap.mtimeMs,
        truncated: snap.truncated,
        // Prefer full history (up to snapshot cap); keep preview alias for older clients.
        lines,
        preview: lines.join("\n"),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
