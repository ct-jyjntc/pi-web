/**
 * Native MCP gateway tool. Replaces pi-mcp-adapter as a factory.
 * Prompt copy is owned by ./prompt.ts (Claude Code: only advertise live servers).
 */
import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { listMcpServers } from "../../mcp-config";
import { buildMcpPromptCopy, enabledMcpServerNames } from "./prompt";
import { NativeMcpRuntime } from "./runtime";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === "") return {};
  if (typeof raw === "string") {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("args must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  throw new Error("args must be a JSON object");
}

const MCP_PARAMETERS = Type.Object({
  tool: Type.Optional(Type.String({ description: "MCP tool name to call." })),
  args: Type.Optional(Type.Union([
    Type.String({ description: "JSON object string." }),
    Type.Object({}, { additionalProperties: true, description: "Tool arguments object." }),
  ])),
  server: Type.Optional(Type.String({ description: "Server name (disambiguates tools)." })),
  connect: Type.Optional(Type.String({ description: "Connect or refresh one server." })),
  describe: Type.Optional(Type.String({ description: "Describe one MCP tool." })),
  search: Type.Optional(Type.String({ description: "Search tool names/descriptions." })),
  action: Type.Optional(Type.String({
    description: "status | list | auth-start | auth-complete",
  })),
});

function registerMcpGateway(
  pi: ExtensionAPI,
  getRuntime: (cwd: string) => NativeMcpRuntime,
  cwd?: string | null,
): void {
  const copy = buildMcpPromptCopy(enabledMcpServerNames(listMcpServers(cwd)));
  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description: copy.description,
    promptSnippet: copy.promptSnippet,
    promptGuidelines: copy.promptGuidelines,
    parameters: MCP_PARAMETERS,
    async execute(_id, raw, signal, _onUpdate, ctx) {
      const params = raw as {
        tool?: string;
        args?: unknown;
        server?: string;
        connect?: string;
        describe?: string;
        search?: string;
        action?: string;
      };
      const mcp = getRuntime(ctx.cwd);

      if (params.action === "auth-start") {
        if (!params.server) return textResult("auth-start requires server.");
        return textResult(await mcp.authStart(params.server));
      }
      if (params.action === "auth-complete") {
        if (!params.server) return textResult("auth-complete requires server.");
        const args = parseArgs(params.args);
        const input = typeof args.redirectUrl === "string"
          ? args.redirectUrl
          : typeof args.code === "string"
            ? args.code
            : "";
        return textResult(await mcp.authComplete(params.server, input));
      }
      if (params.action === "status" || (!params.tool && !params.connect && !params.describe && !params.search && !params.action)) {
        return textResult(await mcp.status());
      }
      if (params.action === "list") {
        const tools = await mcp.listTools(params.server);
        if (tools.length === 0) {
          return textResult("No MCP tools connected. Do not launch leftover Playwright or Chrome via bash.");
        }
        return textResult(tools.map((tool) => `- ${tool.server}/${tool.name}: ${tool.description}`).join("\n"));
      }
      if (params.connect) {
        return textResult(await mcp.connect(params.connect));
      }
      if (params.search) {
        const q = params.search.toLowerCase();
        const tools = (await mcp.listTools(params.server))
          .filter((tool) => `${tool.server} ${tool.name} ${tool.description}`.toLowerCase().includes(q));
        if (tools.length === 0) {
          return textResult(
            `No MCP tools matched "${params.search}". Do not launch leftover Playwright or Chrome via bash.`,
          );
        }
        return textResult(tools.map((tool) => `- ${tool.server}/${tool.name}: ${tool.description}`).join("\n"));
      }
      if (params.describe) {
        await mcp.connect(params.server);
        const tool = mcp.findTool(params.describe, params.server);
        if (!tool) return textResult(`MCP tool "${params.describe}" not found.`);
        return textResult(
          `${tool.server}/${tool.name}\n${tool.description}\n${JSON.stringify(tool.inputSchema ?? {}, null, 2)}`,
        );
      }
      if (params.tool) {
        if (signal?.aborted) return textResult("Aborted.");
        const args = parseArgs(params.args);
        return textResult(await mcp.call(params.tool, args, params.server, signal));
      }
      return textResult(await mcp.status());
    },
  });
}

export function createMcpInlineExtension(): InlineExtension {
  return {
    name: "mcp",
    factory(pi: ExtensionAPI) {
      let runtime: NativeMcpRuntime | null = null;

      const getRuntime = (cwd: string): NativeMcpRuntime => {
        if (!runtime) runtime = new NativeMcpRuntime(cwd);
        return runtime;
      };

      registerMcpGateway(pi, getRuntime);
      pi.on("session_start", (_event, ctx) => {
        runtime = new NativeMcpRuntime(ctx.cwd);
        registerMcpGateway(pi, getRuntime, ctx.cwd);
        void runtime.connect().catch(() => {
          // Connect lazily if background warm fails.
        });
      });
      pi.on("session_shutdown", () => {
        void runtime?.close();
        runtime = null;
      });
    },
  };
}
