/** Shared shapes for Pi Web custom agent tools. */

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
  isError?: boolean;
};

export type ToolDefinitionLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
};

export function textResult(text: string, details?: unknown): ToolResult {
  return details === undefined
    ? { content: [{ type: "text", text }] }
    : { content: [{ type: "text", text }], details };
}

export function errorResult(error: unknown): ToolResult {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}
