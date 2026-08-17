/**
 * Durable child identity: descriptor in the child jsonl + tasks/ scan.
 */
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { childTasksDir, readSessionHeader } from "../../session-reader";

export const SUBAGENT_DESCRIPTOR_TYPE = "subagent-descriptor";

export const MAX_SUBAGENT_DEPTH = 3;

export type SubagentMode = "continuable" | "one-shot";

export type SubagentDescriptor = {
  version: 1;
  mode: SubagentMode;
  agentId: string;
  type: string;
  label: string;
  depth: number;
  /** Wall-clock ms of the parent turn that created this child (capsule "latest turn" scoping). */
  parentTurnStartedAt?: number;
};

export type DiskChild = {
  sessionId: string;
  sessionFile: string;
  descriptor: SubagentDescriptor | null;
  /** ISO timestamp from the child session header (real creation time). */
  createdAt: string;
};

export function isSubagentDescriptor(value: unknown): value is SubagentDescriptor {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return rec.version === 1
    && (rec.mode === "continuable" || rec.mode === "one-shot")
    && typeof rec.agentId === "string"
    && typeof rec.type === "string"
    && typeof rec.label === "string";
}

export function readDescriptorFromSession(sessionFile: string): SubagentDescriptor | null {
  try {
    const manager = SessionManager.open(sessionFile);
    const entries = manager.getEntries();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i] as { type?: string; customType?: string; data?: unknown };
      if (entry.type === "custom" && entry.customType === SUBAGENT_DESCRIPTOR_TYPE) {
        return isSubagentDescriptor(entry.data) ? entry.data : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function listDiskChildren(parentSessionFile: string | undefined): DiskChild[] {
  if (!parentSessionFile) return [];
  const dir = childTasksDir(parentSessionFile);
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: DiskChild[] = [];
  for (const name of files) {
    const sessionFile = join(dir, name);
    const header = readSessionHeader(sessionFile);
    if (!header?.id) continue;
    out.push({
      sessionId: header.id,
      sessionFile,
      descriptor: readDescriptorFromSession(sessionFile),
      createdAt: header.timestamp,
    });
  }
  return out;
}
