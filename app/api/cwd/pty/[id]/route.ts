import { NextRequest, NextResponse } from "next/server";
import { destroyPtySession, getPtySession } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = getPtySession(id);
  if (!session) {
    return NextResponse.json({ error: "Terminal session not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: session.id,
    pid: session.pty.pid,
    shell: session.shell,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    exited: session.exited,
  });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  destroyPtySession(id, "client close");
  return NextResponse.json({ ok: true });
}
