/**
 * Child session identity shared by tools and the renderer.
 * Manager UUID (agent id) is not the jsonl session id — never confuse them.
 */

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

export function childSessionIdFromDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const sessionId = (details as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && isSessionId(sessionId) ? sessionId : null;
}

export function childSessionIdFromText(text: string): string | null {
  const match = /Session ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
  return match?.[1] ?? null;
}

/** Prefer tool-result details; fall back to the durable "Session ID:" line. */
export function childSessionIdFromTool(input: {
  toolName?: string;
  details?: unknown;
  resultText?: string | null;
}): string | null {
  const name = input.toolName ?? "";
  if (name && name !== "subagent" && name !== "get_subagent_result") return null;
  return childSessionIdFromDetails(input.details)
    ?? (input.resultText ? childSessionIdFromText(input.resultText) : null);
}

export function toolDetailsFor(record: { id: string; sessionId?: string }): Record<string, unknown> {
  return {
    agentId: record.id,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  };
}
