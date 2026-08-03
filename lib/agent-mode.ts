/**
 * Unified agent mode shared by the RPC wrapper (server) and the chat UI
 * (client). Combines the tool set (plan strips edit/write) with the global
 * ask/full permission into one session-level mode.
 */
export type AgentMode = "ask" | "auto" | "plan" | "yolo";

export const AGENT_MODES: AgentMode[] = ["ask", "auto", "plan", "yolo"];

export function parseAgentMode(value: unknown): AgentMode {
  return value === "ask" || value === "auto" || value === "plan" || value === "yolo"
    ? value
    : "ask";
}

/** Plan mode runs read-only; ask/auto/yolo keep the full tool allow-list. */
export function agentModeStripsWriteTools(mode: AgentMode): boolean {
  return mode === "plan";
}

/** ask/plan run with the global ask permission; auto/yolo with full (yolo). */
export function agentModeWantsFullPermission(mode: AgentMode): boolean {
  return mode === "auto" || mode === "yolo";
}
