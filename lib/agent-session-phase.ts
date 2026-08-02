/**
 * Pure AgentPhase transitions for tool execution SSE events.
 * UI wiring (setAgentPhase) stays in useAgentSession.
 */

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export function phaseWithToolStart(
  prev: AgentPhase,
  id: string,
  name: string,
): NonNullable<AgentPhase> {
  const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
  if (!tools.some((t) => t.id === id)) tools.push({ id, name });
  return { kind: "running_tools", tools };
}

export function phaseWithToolEnd(prev: AgentPhase, id: string): AgentPhase {
  if (prev?.kind !== "running_tools") return prev;
  const tools = prev.tools.filter((t) => t.id !== id);
  if (tools.length === 0) return { kind: "waiting_model" };
  return { kind: "running_tools", tools };
}
