import { NextResponse } from "next/server";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running — lightweight snapshot for visible-tab polling.
// Prefer this over a long-lived SSE when many browser windows are open.
export async function GET() {
  return NextResponse.json(
    { runningSessionIds: getRunningRpcSessionIds() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
