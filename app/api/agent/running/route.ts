import { NextResponse } from "next/server";
// Thin registry reader — keep this route free of the rpc-manager module graph.
import { getRunningRpcSessionIds } from "@/lib/rpc-running";

export const dynamic = "force-dynamic";

// GET /api/agent/running — lightweight snapshot for visible-tab polling.
// Prefer this over a long-lived SSE when many browser windows are open.
export async function GET() {
  return NextResponse.json(
    { runningSessionIds: getRunningRpcSessionIds() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
