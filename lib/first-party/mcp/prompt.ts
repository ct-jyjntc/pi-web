/**
 * Model-facing copy for the mcp gateway tool.
 *
 * Claude Code only advertises connected servers as first-class
 * `mcp__<server>__<tool>` entries (plus an explicit "unavailable →
 * WebFetch/WebSearch, do not invent a browser" line). We keep one gateway
 * tool; this module is the single owner of what that tool claims.
 */

export type McpPromptCopy = {
  promptSnippet: string;
  description: string;
  promptGuidelines: string[];
};

export function enabledMcpServerNames(
  servers: Array<{ name: string; disabled?: boolean }>,
): string[] {
  return servers
    .filter((server) => server.disabled !== true && server.name.trim())
    .map((server) => server.name.trim());
}

export function buildMcpPromptCopy(serverNames: string[]): McpPromptCopy {
  const names = [...new Set(serverNames.map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) {
    return {
      promptSnippet: "No MCP servers configured — do not call this tool",
      description:
        "No MCP servers are configured in this session. Do not call this tool. " +
        "Do not launch Playwright, Chrome, or leftover MCP caches via bash as a substitute. " +
        "For read-only web pages use web_fetch or web_search. " +
        "Interactive browser automation requires the user to add an MCP server in Settings.",
      promptGuidelines: [
        "MCP: none configured. Do not call mcp, and do not recreate deleted MCP servers (Playwright/Chrome) via bash.",
        "Read-only web: web_fetch or web_search. Interactive browser: ask the user to add an MCP server.",
      ],
    };
  }

  const listed = names.join(", ");
  return {
    promptSnippet: `Call tools on MCP servers: ${listed}`,
    description:
      `Call tools on these MCP servers: ${listed}. ` +
      "Use search/describe first, then tool+args. " +
      "For HTTP servers that need login: action=auth-start then auth-complete with the redirect URL. " +
      "Pass server when two servers expose the same tool name. " +
      "Do not invent tool names that search/list did not return.",
    promptGuidelines: [
      `MCP servers available: ${listed}. Prefer mcp({ search }) then mcp({ tool, args, server }).`,
    ],
  };
}
