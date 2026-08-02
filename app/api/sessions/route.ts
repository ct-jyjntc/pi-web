import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
// Thin registry reader — must not import rpc-manager (pulls the full agent SDK + tools).
import { getRunningRpcSessionIds } from "@/lib/rpc-running";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
