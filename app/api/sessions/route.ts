import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
// Thin registry reader — must not import rpc-manager (pulls the full agent SDK + tools).
import { getRunningRpcSessionIds } from "@/lib/rpc-running";

export async function GET(req: Request) {
  try {
    // `?fresh=1` bypasses the 30s in-process list cache. Needed after delete/rename:
    // mutations run on the heavy runtime while this list is served by light, so
    // invalidateSessionListCache() never reaches the process that caches the list.
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const sessions = await listAllSessions({ force: fresh });
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
