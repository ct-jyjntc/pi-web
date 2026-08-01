/**
 * MCP server config helpers for Pi Web.
 * Compatible with pi-mcp-adapter / standard `.mcp.json` shapes.
 *
 * Editable store (add/remove/edit): ~/.pi/agent/mcp.json
 * Project overlay (optional disabled flags): <cwd>/.pi/mcp.json
 * Read-only discovery also surfaces shared/project files for the list UI.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./type-guards";

export type McpServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
  disabled?: boolean;
  [key: string]: unknown;
};

export type McpServerListItem = {
  name: string;
  config: McpServerEntry;
  /** Absolute path of the file that owns the base definition (not the disabled overlay). */
  sourcePath: string;
  sourceLabel: "agent" | "user-global" | "project" | "project-pi" | "other";
  /** Effective disabled after merge. */
  disabled: boolean;
  /** Whether Pi Web can edit this definition in agent mcp.json. */
  editable: boolean;
};

export type McpConfigFile = {
  mcpServers: Record<string, McpServerEntry>;
};

export function getAgentMcpPath(): string {
  return join(getAgentDir(), "mcp.json");
}

export function getUserGlobalMcpPaths(): string[] {
  const home = homedir();
  return [
    join(home, ".config", "mcp", "mcp.json"),
    join(home, ".agents", "mcp.json"),
    join(home, ".agents", "mcp", "mcp.json"),
  ];
}

export function getProjectMcpPaths(cwd: string | null | undefined): string[] {
  if (!cwd) return [];
  return [
    join(cwd, ".mcp.json"),
    join(cwd, ".pi", "mcp.json"),
  ];
}

function sourceLabelForPath(path: string, cwd: string | null | undefined): McpServerListItem["sourceLabel"] {
  if (path === getAgentMcpPath()) return "agent";
  if (getUserGlobalMcpPaths().includes(path)) return "user-global";
  if (cwd && path === join(cwd, ".mcp.json")) return "project";
  if (cwd && path === join(cwd, ".pi", "mcp.json")) return "project-pi";
  return "other";
}

export function readMcpConfigFile(path: string): McpConfigFile {
  if (!existsSync(path)) return { mcpServers: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(raw)) return { mcpServers: {} };
    const servers = raw.mcpServers ?? raw["mcp-servers"];
    if (!isRecord(servers)) return { mcpServers: {} };
    const mcpServers: Record<string, McpServerEntry> = {};
    for (const [name, value] of Object.entries(servers)) {
      if (isRecord(value)) mcpServers[name] = value as McpServerEntry;
    }
    return { mcpServers };
  } catch {
    return { mcpServers: {} };
  }
}

export function writeMcpConfigFile(path: string, config: McpConfigFile): void {
  mkdirSync(dirname(path), { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (isRecord(parsed)) existing = parsed;
    } catch {
      existing = {};
    }
  }
  const next: Record<string, unknown> = {
    ...existing,
    mcpServers: config.mcpServers,
  };
  // Prefer mcpServers key; drop alternate if we rewrote.
  delete next["mcp-servers"];
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function isDisabled(entry: McpServerEntry | undefined): boolean {
  return entry?.disabled === true;
}

/**
 * List effective servers for UI.
 * Later sources override earlier ones (aligned with common MCP precedence; Pi adapter
 * has its own order — we surface a useful merged view for management).
 */
export function listMcpServers(cwd?: string | null): McpServerListItem[] {
  const layers: string[] = [
    ...getUserGlobalMcpPaths(),
    getAgentMcpPath(),
    ...getProjectMcpPaths(cwd),
  ];

  type Acc = {
    name: string;
    config: McpServerEntry;
    sourcePath: string;
  };
  const map = new Map<string, Acc>();

  for (const path of layers) {
    if (!existsSync(path)) continue;
    const file = readMcpConfigFile(path);
    for (const [name, config] of Object.entries(file.mcpServers)) {
      const prev = map.get(name);
      // disabled-only overlay: keep previous base command/url when present
      if (prev && !config.command && !config.url && config.disabled !== undefined) {
        map.set(name, {
          name,
          config: { ...prev.config, disabled: config.disabled },
          sourcePath: prev.sourcePath,
        });
        continue;
      }
      map.set(name, {
        name,
        config: { ...(prev?.config ?? {}), ...config },
        sourcePath: path,
      });
    }
  }

  const agentPath = getAgentMcpPath();
  return [...map.values()]
    .map((item) => {
      const label = sourceLabelForPath(item.sourcePath, cwd ?? null);
      return {
        name: item.name,
        config: item.config,
        sourcePath: item.sourcePath,
        sourceLabel: label,
        disabled: isDisabled(item.config),
        editable: item.sourcePath === agentPath || label === "agent",
      } satisfies McpServerListItem;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertAgentMcpServer(name: string, entry: McpServerEntry): McpServerListItem {
  const trimmed = name.trim();
  if (!trimmed) throw Object.assign(new Error("Server name required"), { status: 400 });
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw Object.assign(new Error("Server name may only contain letters, numbers, . _ -"), { status: 400 });
  }
  const path = getAgentMcpPath();
  const file = readMcpConfigFile(path);
  const prev = file.mcpServers[trimmed] ?? {};
  const nextEntry: McpServerEntry = { ...prev, ...entry };
  // Normalize empty args
  if (Array.isArray(nextEntry.args)) {
    nextEntry.args = nextEntry.args.map(String).filter((a) => a.length > 0);
  }
  if (!nextEntry.command && !nextEntry.url) {
    throw Object.assign(new Error("Provide a command (stdio) or url (HTTP)"), { status: 400 });
  }
  file.mcpServers[trimmed] = nextEntry;
  writeMcpConfigFile(path, file);
  return {
    name: trimmed,
    config: nextEntry,
    sourcePath: path,
    sourceLabel: "agent",
    disabled: isDisabled(nextEntry),
    editable: true,
  };
}

export function removeAgentMcpServer(name: string): void {
  const path = getAgentMcpPath();
  const file = readMcpConfigFile(path);
  if (!(name in file.mcpServers)) {
    throw Object.assign(new Error("Server not found in Pi agent MCP config"), { status: 404 });
  }
  delete file.mcpServers[name];
  writeMcpConfigFile(path, file);
}

/**
 * Toggle disabled flag.
 * - Editable agent servers: write into ~/.pi/agent/mcp.json
 * - Others: write disabled overlay into project .pi/mcp.json when cwd provided,
 *   else into agent mcp.json as a disabled-only stub (enable removes stub if no other fields).
 */
export function setMcpServerDisabled(
  name: string,
  disabled: boolean,
  cwd?: string | null,
): McpServerListItem {
  const listed = listMcpServers(cwd);
  const current = listed.find((s) => s.name === name);
  if (!current) {
    throw Object.assign(new Error("Server not found"), { status: 404 });
  }

  if (current.editable || current.sourcePath === getAgentMcpPath()) {
    const path = getAgentMcpPath();
    const file = readMcpConfigFile(path);
    const entry = { ...(file.mcpServers[name] ?? current.config) };
    if (disabled) entry.disabled = true;
    else delete entry.disabled;
    file.mcpServers[name] = entry;
    writeMcpConfigFile(path, file);
  } else if (cwd) {
    const path = join(cwd, ".pi", "mcp.json");
    const file = readMcpConfigFile(path);
    const existing = file.mcpServers[name] ?? {};
    if (disabled) {
      file.mcpServers[name] = { ...existing, disabled: true };
    } else if (Object.keys(existing).filter((k) => k !== "disabled").length === 0) {
      delete file.mcpServers[name];
    } else {
      const next = { ...existing };
      delete next.disabled;
      file.mcpServers[name] = next;
    }
    writeMcpConfigFile(path, file);
  } else {
    throw Object.assign(
      new Error("Open a project to toggle servers that are not in Pi agent MCP config"),
      { status: 400 },
    );
  }

  const after = listMcpServers(cwd).find((s) => s.name === name);
  if (!after) throw Object.assign(new Error("Server missing after update"), { status: 500 });
  return after;
}

export function getMcpAdapterStatus(): {
  configured: boolean;
  installed: boolean;
  packageSource: string;
} {
  // pi-mcp-adapter is a first-party app dependency (see lib/builtin-extensions.ts),
  // not an optional ~/.pi/agent package. Report present when the app install has it.
  const source = "app:pi-mcp-adapter";
  const appPkg = join(process.cwd(), "node_modules", "pi-mcp-adapter", "package.json");
  const installed =
    existsSync(appPkg)
    || existsSync(join(getAgentDir(), "npm", "node_modules", "pi-mcp-adapter", "package.json"));
  return { configured: installed, installed, packageSource: source };
}
