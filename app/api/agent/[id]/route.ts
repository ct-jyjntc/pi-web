import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-registry";
import { readLiveAgentState } from "@/lib/agent-live-state";
import { jsonError } from "@/lib/api-response";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session (registry only — no tool graph).
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath || !existsSync(filePath)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the header line: SessionManager.open() would parse and index the
    // whole archive synchronously (~60ms on a 26MB session) just for this field.
    const cwd = readSessionHeader(filePath)?.cwd ?? process.cwd();

    // Lazy: startRpcSession pulls the tool graph; keep it off the GET path.
    const { startRpcSession } = await import("@/lib/rpc-session-start");
    const { session } = await startRpcSession(id, filePath, cwd);
    if (!session.isAlive()) {
      return NextResponse.json({ error: "Session destroyed" }, { status: 409 });
    }
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Session destroyed" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// GET /api/agent/[id] - Get current agent state (no start, no tool graph)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    return NextResponse.json(await readLiveAgentState(id));
  } catch (error) {
    return jsonError(error);
  }
}
