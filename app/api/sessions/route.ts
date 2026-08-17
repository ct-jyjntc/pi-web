import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    // `?fresh=1` bypasses the 30s in-process list cache. Needed after delete/rename:
    // mutations run on the heavy runtime while this list is served by light, so
    // invalidateSessionListCache() never reaches the process that caches the list.
    const fresh = params.get("fresh") === "1";
    // `?archived=1` returns only soft-archived sessions (Settings → Archived).
    // The main sidebar list always excludes them.
    const archivedOnly = params.get("archived") === "1";
    const sessions = await listAllSessions({ force: fresh, archivedOnly });
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
