/** Full built-in tool set used for every session (tool-preset UI removed). */
export const FULL_TOOL_NAMES = [
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export function getFullToolNames(): string[] {
  return [...FULL_TOOL_NAMES];
}
