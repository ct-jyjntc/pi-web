/**
 * Process-local parent session → manager map so RPC can reach live children.
 * Child runs are also keyed by child session id for live SSE (no second AgentSession).
 */
import type { ChildRun } from "./child-session";
import type { NativeSubagentManager } from "./manager";

const managers = new Map<string, NativeSubagentManager>();
const childRuns = new Map<string, { parentSessionId: string; run: ChildRun }>();

export function registerSubagentHost(parentSessionId: string, manager: NativeSubagentManager): void {
  managers.set(parentSessionId, manager);
}

export function unregisterSubagentHost(parentSessionId: string, manager?: NativeSubagentManager): void {
  if (manager && managers.get(parentSessionId) !== manager) return;
  managers.delete(parentSessionId);
}

export function getSubagentHost(parentSessionId: string): NativeSubagentManager | undefined {
  return managers.get(parentSessionId);
}

export function registerChildRun(parentSessionId: string, run: ChildRun): void {
  if (!run.sessionId) return;
  childRuns.set(run.sessionId, { parentSessionId, run });
}

export function unregisterChildRun(sessionId: string | undefined, run?: ChildRun): void {
  if (!sessionId) return;
  const current = childRuns.get(sessionId);
  if (run && current?.run !== run) return;
  childRuns.delete(sessionId);
}

export function getChildRun(sessionId: string): { parentSessionId: string; run: ChildRun } | undefined {
  return childRuns.get(sessionId);
}
