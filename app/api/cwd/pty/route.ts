import { NextRequest, NextResponse } from "next/server";
import { createPtySession } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; cols?: number; rows?: number };
    const cwd = body.cwd?.trim() ?? "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const session = await createPtySession({
      cwd,
      cols: body.cols,
      rows: body.rows,
    });
    return NextResponse.json(session);
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
