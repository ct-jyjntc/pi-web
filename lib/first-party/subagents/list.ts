/**
 * Model-facing list_agents projection: running / idle / ready, optional descendants.
 */
import { listDiskChildren, MAX_SUBAGENT_DEPTH } from "./durable";
import { getSubagentHost } from "./host";
import type { NativeSubagentManager } from "./manager";
import type { SubagentRecord } from "./types";

export type AgentListScope = "children" | "descendants";
export type AgentListStatus = "running" | "idle" | "ready";

export type AgentListEntry = {
  kind: "child";
  id: string;
  agentId: string;
  label: string;
  status: AgentListStatus;
  parent?: string;
  depth?: number;
};

export function listStatus(record: SubagentRecord, resident: boolean): AgentListStatus {
  if (record.status === "running" || record.status === "queued") return "running";
  if (resident) return "idle";
  return "ready";
}

export function projectContinuable(
  record: SubagentRecord,
  resident: boolean,
  position?: { parent: string; depth: number },
): AgentListEntry | null {
  if (record.mode === "one-shot") return null;
  return {
    kind: "child",
    id: record.sessionId || record.id,
    agentId: record.id,
    label: record.description || record.displayName,
    status: listStatus(record, resident),
    parent: position?.parent,
    depth: position?.depth,
  };
}

export function formatAgentList(entries: readonly AgentListEntry[], scope: AgentListScope): string {
  if (entries.length === 0) return "(no subagents)";
  return entries.map((entry) => {
    const at = scope === "descendants"
      ? ` parent=${entry.parent ?? ""} depth=${entry.depth ?? 1}`
      : "";
    return `${entry.id} [${entry.status}]${at} — ${entry.label}`;
  }).join("\n");
}

export function listAgents(
  manager: NativeSubagentManager,
  input: {
    scope: AgentListScope;
    parentSessionId?: string;
    parentSessionFile?: string;
  },
): AgentListEntry[] {
  if (input.scope === "children") {
    return projectManager(manager);
  }
  const seen = new Set<string>();
  const out: AgentListEntry[] = [];
  const parentId = input.parentSessionId ?? "";
  addManager(manager, parentId, 1, seen, out);
  if (input.parentSessionFile && parentId) {
    walkDisk(input.parentSessionFile, parentId, 1, seen, out);
  }
  return out;
}

function projectManager(
  manager: NativeSubagentManager,
  position?: { parent: string; depth: number },
): AgentListEntry[] {
  const entries: AgentListEntry[] = [];
  for (const record of manager.list()) {
    const entry = projectContinuable(record, manager.isResident(record.id), position);
    if (entry) entries.push(entry);
  }
  return entries;
}

function addManager(
  manager: NativeSubagentManager,
  parentId: string,
  depth: number,
  seen: Set<string>,
  out: AgentListEntry[],
): void {
  for (const entry of projectManager(manager, { parent: parentId, depth })) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
}

function walkDisk(
  parentFile: string,
  parentId: string,
  depth: number,
  seen: Set<string>,
  out: AgentListEntry[],
): void {
  if (depth > MAX_SUBAGENT_DEPTH) return;
  const nested = getSubagentHost(parentId);
  if (nested && depth > 1) addManager(nested, parentId, depth, seen, out);
  for (const disk of listDiskChildren(parentFile)) {
    const oneShot = disk.descriptor?.mode === "one-shot";
    if (!oneShot && !seen.has(disk.sessionId)) {
      const live = nested?.get(disk.sessionId) ?? nested?.get(disk.descriptor?.agentId ?? "");
      if (live) {
        const entry = projectContinuable(live, nested?.isResident(live.id) ?? false, {
          parent: parentId,
          depth,
        });
        if (entry && !seen.has(entry.id)) {
          seen.add(entry.id);
          out.push(entry);
        }
      } else {
        seen.add(disk.sessionId);
        out.push({
          kind: "child",
          id: disk.sessionId,
          agentId: disk.descriptor?.agentId ?? disk.sessionId,
          label: disk.descriptor?.label || disk.sessionId,
          status: "ready",
          parent: parentId,
          depth,
        });
      }
    }
    if (disk.sessionFile) {
      walkDisk(disk.sessionFile, disk.sessionId, depth + 1, seen, out);
    }
  }
}

export function buildCatalogRecords(
  manager: NativeSubagentManager,
  parentSessionId?: string,
  parentSessionFile?: string,
): SubagentRecord[] {
  if (!parentSessionId) return manager.listCurrent();
  const entries = listAgents(manager, {
    scope: "descendants",
    parentSessionId,
    parentSessionFile,
  });
  if (entries.length === 0) return manager.listCurrent();
  return entries.map((entry) => {
    const host = entry.parent ? getSubagentHost(entry.parent) : manager;
    const live = host?.get(entry.id) ?? host?.get(entry.agentId) ?? manager.get(entry.id) ?? manager.get(entry.agentId);
    if (live) {
      return {
        ...live,
        depth: entry.depth ?? 1,
        parentSessionId: entry.parent,
      };
    }
    return {
      id: entry.agentId,
      type: "Agent",
      displayName: "Agent",
      description: entry.label,
      status: entry.status === "running" ? "running" : "completed",
      startedAt: 0,
      sessionId: entry.id,
      mode: "continuable" as const,
      depth: entry.depth ?? 1,
      parentSessionId: entry.parent,
    };
  });
}
