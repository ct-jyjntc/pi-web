/**
 * Connect to configured MCP servers (stdio, Streamable HTTP, SSE) and call tools.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { listMcpServers, type McpServerEntry, type McpServerListItem } from "../../mcp-config";
import { completeMcpOAuth, FileOAuthProvider, startMcpOAuth } from "./oauth";

export type McpToolInfo = {
  server: string;
  name: string;
  description: string;
  inputSchema?: unknown;
};

type LiveServer = {
  name: string;
  client: Client;
  tools: McpToolInfo[];
  error?: string;
};

function isUnauthorized(error: unknown): boolean {
  return error instanceof UnauthorizedError
    || (error instanceof StreamableHTTPError && error.code === 401);
}

function authHint(serverName: string): string {
  return `Server "${serverName}" requires OAuth. Run mcp({ action: "auth-start", server: "${serverName}" }).`;
}

function abortSignalPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

export class NativeMcpRuntime {
  private readonly servers = new Map<string, LiveServer>();

  constructor(private readonly cwd: string) {}

  listConfigured(): McpServerListItem[] {
    return listMcpServers(this.cwd).filter((item) => !item.disabled);
  }

  findConfigured(name: string): McpServerListItem | undefined {
    return this.listConfigured().find((item) => item.name === name);
  }

  async connect(name?: string): Promise<string> {
    const targets = this.listConfigured().filter((item) => !name || item.name === name);
    if (name && targets.length === 0) return `MCP server "${name}" is not configured or is disabled.`;
    const notes: string[] = [];
    for (const item of targets) {
      notes.push(await this.connectOne(item.name, item.config));
    }
    return notes.join("\n");
  }

  async status(): Promise<string> {
    const configured = this.listConfigured();
    if (configured.length === 0) return "No MCP servers configured.";
    const lines = configured.map((item) => {
      const live = this.servers.get(item.name);
      if (live?.error) return `- ${item.name}: error (${live.error})`;
      if (live) return `- ${item.name}: connected (${live.tools.length} tools)`;
      return `- ${item.name}: configured, not connected`;
    });
    return ["MCP servers:", ...lines].join("\n");
  }

  async listTools(server?: string): Promise<McpToolInfo[]> {
    await this.connect(server);
    const out: McpToolInfo[] = [];
    for (const live of this.servers.values()) {
      if (server && live.name !== server) continue;
      out.push(...live.tools);
    }
    return out;
  }

  findTool(toolName: string, server?: string): McpToolInfo | undefined {
    const matches: McpToolInfo[] = [];
    for (const live of this.servers.values()) {
      if (server && live.name !== server) continue;
      for (const tool of live.tools) {
        if (tool.name === toolName) matches.push(tool);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1 && !server) return undefined;
    return matches[0];
  }

  async call(toolName: string, args: Record<string, unknown>, server?: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return "Aborted.";
    await this.connect(server);
    if (signal?.aborted) return "Aborted.";
    const tool = this.findTool(toolName, server);
    if (!tool) {
      const listed = await this.listTools(server);
      const names = listed.map((item) => `${item.server}/${item.name}`).join(", ") || "(none)";
      return `MCP tool "${toolName}" not found. Available: ${names}`;
    }
    const live = this.servers.get(tool.server);
    if (!live || live.error) return `MCP server "${tool.server}" is not connected.`;
    try {
      const call = live.client.callTool({ name: tool.name, arguments: args });
      const result = signal ? await Promise.race([call, abortSignalPromise(signal)]) : await call;
      const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
      if (Array.isArray(content) && content.length > 0) {
        return content.map((block) => block.text ?? JSON.stringify(block)).join("\n");
      }
      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.message === "aborted")) return "Aborted.";
      if (isUnauthorized(error)) return authHint(tool.server);
      throw error;
    }
  }

  async authStart(serverName: string): Promise<string> {
    const item = this.findConfigured(serverName);
    if (!item) return `MCP server "${serverName}" is not configured or is disabled.`;
    if (!item.config.url) return `MCP server "${serverName}" is stdio — OAuth is only used for HTTP/SSE servers.`;
    return startMcpOAuth(serverName, item.config.url);
  }

  async authComplete(serverName: string, input: string): Promise<string> {
    const item = this.findConfigured(serverName);
    if (!item) return `MCP server "${serverName}" is not configured or is disabled.`;
    if (!item.config.url) return `MCP server "${serverName}" is stdio — OAuth is only used for HTTP/SSE servers.`;
    const done = await completeMcpOAuth(serverName, item.config.url, input);
    this.servers.delete(serverName);
    const reconnect = await this.connect(serverName);
    return `${done}\n${reconnect}`;
  }

  async close(): Promise<void> {
    for (const live of this.servers.values()) {
      try {
        await live.client.close();
      } catch {
        // ignore
      }
    }
    this.servers.clear();
  }

  private async connectOne(name: string, config: McpServerEntry): Promise<string> {
    const existing = this.servers.get(name);
    if (existing && !existing.error) return `${name}: already connected`;
    if (!config.command && !config.url) return `${name}: missing command or url`;
    try {
      const { client, tools } = await this.openClient(name, config);
      this.servers.set(name, { name, client, tools });
      return `${name}: connected (${tools.length} tools)`;
    } catch (error) {
      const message = isUnauthorized(error)
        ? authHint(name)
        : error instanceof Error ? error.message : String(error);
      this.servers.set(name, {
        name,
        client: new Client({ name: "pi-web", version: "1.0.0" }),
        tools: [],
        error: message,
      });
      return `${name}: failed (${message})`;
    }
  }

  private async openClient(
    name: string,
    config: McpServerEntry,
  ): Promise<{ client: Client; tools: McpToolInfo[] }> {
    const transport = config.url && !config.command
      ? await this.createHttpTransport(name, config)
      : new StdioClientTransport({
          command: config.command!,
          args: Array.isArray(config.args) ? config.args : [],
          env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
          cwd: typeof config.cwd === "string" && config.cwd.trim() ? config.cwd.trim() : this.cwd,
          stderr: "ignore",
        });
    const client = new Client({ name: "pi-web", version: "1.0.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = (listed.tools ?? []).map((tool) => ({
      server: name,
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }));
    return { client, tools };
  }

  private async createHttpTransport(name: string, config: McpServerEntry): Promise<Transport> {
    const url = new URL(String(config.url));
    const headers = httpHeaders(config);
    const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;
    const authProvider = httpAuthProvider(name, config);

    const streamable = new StreamableHTTPClientTransport(url, { requestInit, authProvider });
    const probe = new Client({ name: "pi-web-probe", version: "1.0.0" });
    try {
      await probe.connect(streamable);
      await probe.close();
      return new StreamableHTTPClientTransport(url, { requestInit, authProvider });
    } catch (error) {
      try {
        await probe.close();
      } catch {
        // probe already failed
      }
      if (isUnauthorized(error)) throw error;
      return new SSEClientTransport(url, { requestInit, authProvider });
    }
  }
}

function httpHeaders(config: McpServerEntry): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
  }
  const bearer = typeof config.bearerToken === "string"
    ? config.bearerToken
    : typeof config.bearerTokenEnv === "string"
      ? process.env[config.bearerTokenEnv]
      : undefined;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

function httpAuthProvider(name: string, config: McpServerEntry): OAuthClientProvider | undefined {
  if (config.auth === false || config.oauth === false) return undefined;
  if (config.auth === "bearer") return undefined;
  const stored = new FileOAuthProvider(name);
  if (stored.tokens() || config.auth === "oauth" || config.oauth) return stored;
  return undefined;
}
