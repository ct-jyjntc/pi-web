import { NextResponse } from "next/server";
import { readLiveAgentState } from "@/lib/agent-live-state";
import { jsonError } from "@/lib/api-response";

/**
 * Alias of GET /api/agent/[id] for session-scoped clients.
 * Prefer /api/agent/[id] for new code.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json(await readLiveAgentState(id));
  } catch (error) {
    return jsonError(error);
  }
}
