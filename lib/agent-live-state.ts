import { getRpcSession } from "./rpc-registry";

/**
 * Shared live-state snapshot for GET /api/agent/[id] and the sessions alias.
 * Does not start an RPC session — only reports an already-running wrapper.
 * Imports rpc-registry only so cold open does not pay for rpc-manager / tools.
 */
export async function readLiveAgentState(sessionId: string): Promise<{
  running: boolean;
  state?: unknown;
}> {
  const session = getRpcSession(sessionId);
  if (!session?.isAlive()) return { running: false };
  const state = await session.send({ type: "get_state" });
  return { running: true, state };
}
