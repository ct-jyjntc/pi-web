/**
 * Extra agent tools: diagnostics, web_fetch, web_search.
 */
import { Type } from "typebox";
import { collectDiagnostics, formatDiagnosticsForAgent } from "./diagnostics";
import { webFetch, webSearch } from "./web-tools";
import { errorResult, type ToolDefinitionLike } from "./agent-tool-types";

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
        return errorResult(error);
      }
    },
  };
}

export function createWebTools(): ToolDefinitionLike[] {
  const fetchTool: ToolDefinitionLike = {
    name: "web_fetch",
    label: "web_fetch",
    description:
      "Fetch a URL and return readable text/markdown (HTML stripped). For public http(s) pages. " +
      "Not a browser: cannot click, log in, run JavaScript, or take screenshots.",
    promptSnippet: "Read a public web page as text (not a browser)",
    promptGuidelines: [
      "web_fetch is read-only text. For screenshots or clicking, use a live MCP browser server — do not invent one via bash.",
    ],
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
        return errorResult(error);
      }
    },
  };

  const searchTool: ToolDefinitionLike = {
    name: "web_search",
    label: "web_search",
    description:
      "Search the public web (DuckDuckGo). Returns titled results with URLs and snippets. " +
      "Not a browser and cannot open or screenshot pages — follow up with web_fetch for page text.",
    promptSnippet: "Search the public web (not a browser)",
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
        return errorResult(error);
      }
    },
  };

  return [fetchTool, searchTool];
}
