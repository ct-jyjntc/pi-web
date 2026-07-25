import { NextRequest, NextResponse } from "next/server";
import { resizePtySession } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { cols?: number; rows?: number };
    const cols = Number(body.cols);
    const rows = Number(body.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      return NextResponse.json({ error: "cols and rows required" }, { status: 400 });
    }
    resizePtySession(id, cols, rows);
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
