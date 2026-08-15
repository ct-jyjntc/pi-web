/**
 * Process-local parent session → manager map so RPC can reach live children.
 */
import type { NativeSubagentManager } from "./manager";

const managers = new Map<string, NativeSubagentManager>();

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
