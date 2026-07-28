import { NextRequest, NextResponse } from "next/server";
import { createPtySession, listPtySessions, type PtySource } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() || undefined;
    const sourceParam = request.nextUrl.searchParams.get("source")?.trim();
    const source = sourceParam === "agent" || sourceParam === "user"
      ? sourceParam as PtySource
      : undefined;
    const agentSessionId = request.nextUrl.searchParams.get("agentSessionId")?.trim() || undefined;
    const sessions = listPtySessions({ cwd, source, agentSessionId });
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      cols?: number;
      rows?: number;
      command?: string;
      source?: PtySource;
      agentSessionId?: string;
      title?: string;
    };
    const cwd = body.cwd?.trim() ?? "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const session = await createPtySession({
      cwd,
      cols: body.cols,
      rows: body.rows,
      command: body.command,
      source: body.source,
      agentSessionId: body.agentSessionId,
      title: body.title,
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
