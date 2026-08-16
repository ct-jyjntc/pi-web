/**
 * Pure AgentPhase transitions for tool execution SSE events.
 * UI wiring (setAgentPhase) stays in useAgentSession.
 */

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string; progress?: string }[] }
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

export function phaseWithToolProgress(
  prev: AgentPhase,
  id: string,
  name: string,
  progress: string | null,
): NonNullable<AgentPhase> {
  const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
  const existing = tools.find((tool) => tool.id === id);
  const updated = {
    id,
    name: name || existing?.name || "tool",
    progress: progress ?? existing?.progress,
  };
  return {
    kind: "running_tools",
    tools: [...tools.filter((tool) => tool.id !== id), updated],
  };
}

export function phaseWithToolEnd(prev: AgentPhase, id: string): AgentPhase {
  if (prev?.kind !== "running_tools") return prev;
  const tools = prev.tools.filter((t) => t.id !== id);
  if (tools.length === 0) return { kind: "waiting_model" };
  return { kind: "running_tools", tools };
}
