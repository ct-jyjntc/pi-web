/**
 * Extra agent tools: diagnostics, web_fetch, web_search, checkpoint, rewind, advisor note helpers.
 */
import { Type } from "typebox";
import { collectDiagnostics, formatDiagnosticsForAgent } from "./diagnostics";
import {
  createCheckpoint,
  listCheckpoints,
  formatCheckpointsForAgent,
  type CheckpointStore,
} from "./session-checkpoint";
import { webFetch, webSearch } from "./web-tools";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
  isError?: boolean;
};

type ToolDefinitionLike = {
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

export function createDiagnosticsTool(cwd: string): ToolDefinitionLike {
  return {
    name: "diagnostics",
    label: "diagnostics",
    description:
      "Run project diagnostics (TypeScript tsc --noEmit and ESLint if installed). Optionally scope to one file path.",
    promptSnippet: "Get compiler/linter diagnostics for the project or a file",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Optional absolute or project-relative file path" })),
    }),
    async execute(_id, args) {
      try {
        const filePath = typeof args.path === "string" ? args.path : undefined;
        const result = await collectDiagnostics(cwd, { filePath });
        return {
          content: [{ type: "text", text: formatDiagnosticsForAgent(result) }],
          details: result,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };
}

export function createWebTools(): ToolDefinitionLike[] {
  const fetchTool: ToolDefinitionLike = {
    name: "web_fetch",
    label: "web_fetch",
    description: "Fetch a URL and return readable text/markdown (HTML stripped). For public http(s) pages.",
    promptSnippet: "Read a web page or API URL as text",
    parameters: Type.Object({
      url: Type.String({ description: "http(s) URL" }),
      maxChars: Type.Optional(Type.Number({ description: "Max characters to return (default 12000)" })),
    }),
    async execute(_id, args, signal) {
      try {
        const result = await webFetch(String(args.url ?? ""), {
          maxChars: typeof args.maxChars === "number" ? args.maxChars : 12_000,
          signal,
        });
        return {
          content: [{ type: "text", text: result.text }],
          details: { url: result.url, contentType: result.contentType, status: result.status },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const searchTool: ToolDefinitionLike = {
    name: "web_search",
    label: "web_search",
    description: "Search the public web (DuckDuckGo). Returns titled results with URLs and snippets.",
    promptSnippet: "Search the web for documentation or answers",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 5, max 10)" })),
    }),
    async execute(_id, args, signal) {
      try {
        const limit = typeof args.limit === "number" ? Math.min(10, Math.max(1, args.limit)) : 5;
        const results = await webSearch(String(args.query ?? ""), { limit, signal });
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No search results." }] };
        }
        const text = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");
        return { content: [{ type: "text", text }], details: { results } };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  return [fetchTool, searchTool];
}

export function createCheckpointTools(options: {
  getSessionId: () => string | undefined;
  getLeafId?: () => string | undefined;
}): ToolDefinitionLike[] {
  const retain: ToolDefinitionLike = {
    name: "checkpoint",
    label: "checkpoint",
    description:
      "Mark a named checkpoint in this session so you can rewind later. Include a short summary of state. Optionally pass entryId of the current leaf message.",
    promptSnippet: "Save a named session checkpoint",
    parameters: Type.Object({
      name: Type.String({ description: "Short checkpoint name" }),
      summary: Type.Optional(Type.String({ description: "What was accomplished / current state" })),
      entryId: Type.Optional(Type.String({ description: "Optional message entry id to rewind to" })),
    }),
    async execute(_id, args) {
      const sessionId = options.getSessionId();
      if (!sessionId) {
        return { content: [{ type: "text", text: "No active session id" }], isError: true };
      }
      const entryId =
        typeof args.entryId === "string" && args.entryId.trim()
          ? args.entryId.trim()
          : options.getLeafId?.();
      const cp = createCheckpoint(sessionId, {
        name: String(args.name ?? "checkpoint"),
        summary: typeof args.summary === "string" ? args.summary : "",
        entryId,
      });
      return {
        content: [{ type: "text", text: `Checkpoint saved: ${cp.name} (${cp.id})${entryId ? ` entry=${entryId}` : ""}` }],
        details: cp,
      };
    },
  };

  const list: ToolDefinitionLike = {
    name: "checkpoint_list",
    label: "checkpoint_list",
    description: "List checkpoints for the current session.",
    promptSnippet: "List session checkpoints",
    parameters: Type.Object({}),
    async execute() {
      const sessionId = options.getSessionId();
      if (!sessionId) {
        return { content: [{ type: "text", text: "No active session id" }], isError: true };
      }
      const items = listCheckpoints(sessionId);
      return {
        content: [{ type: "text", text: formatCheckpointsForAgent(items) }],
        details: { checkpoints: items } satisfies { checkpoints: CheckpointStore["checkpoints"] },
      };
    },
  };

  return [retain, list];
}
