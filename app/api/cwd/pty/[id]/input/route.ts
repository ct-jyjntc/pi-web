import { NextRequest, NextResponse } from "next/server";
import { writePtySession } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { data?: string };
    if (typeof body.data !== "string" || body.data.length === 0) {
      return NextResponse.json({ error: "data required" }, { status: 400 });
    }
    // Guard against accidental huge pastes freezing the process.
    if (body.data.length > 64 * 1024) {
      return NextResponse.json({ error: "input too large" }, { status: 413 });
    }
    writePtySession(id, body.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
