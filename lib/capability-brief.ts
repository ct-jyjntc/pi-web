/**
 * Claude-style capability truth appended to the system prompt.
 *
 * Claude Code only advertises connected tools and, when a capability is
 * missing, names the fallback (WebFetch/WebSearch) and forbids inventing a
 * substitute. Single owner for that session-level copy; tool-specific empty
 * states stay on the tool (mcp/prompt.ts).
 */

export function buildCapabilityBrief(): string {
  return [
    "## Capabilities",
    "",
    "Use only the tools listed under Available tools and in the function schema. The sentence about \"other custom tools\" does not add hidden tools.",
    "- Files: read / edit / write / grep / find / ls. Do not use bash for cat, sed, or searching files.",
    "- Shell: bash for builds, git, installs, and one-off commands — not a browser.",
    "- Read-only web: web_fetch or web_search. They cannot click, log in, or take screenshots.",
    "- Browser automation: only if the mcp tool lists a live server. If it says none configured, do not launch Playwright, Chrome, or leftover MCP caches via bash. Ask the user to add an MCP server, or use web_fetch.",
    "- GitHub: the github tool (or `gh`). Do not scrape github.com HTML.",
  ].join("\n");
}
