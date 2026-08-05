import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { getAgentDir } from "./agent-dir";

export type SessionCheckpoint = {
  id: string;
  name: string;
  summary: string;
  entryId?: string;
  createdAt: string;
};

export type CheckpointStore = {
  sessionId: string;
  checkpoints: SessionCheckpoint[];
};

function storePath(sessionId: string): string {
  const dir = join(getAgentDir(), "checkpoints");
  mkdirSync(dir, { recursive: true });
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(dir, `${safe}.json`);
}

export function listCheckpoints(sessionId: string): SessionCheckpoint[] {
  const path = storePath(sessionId);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CheckpointStore;
    return Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
  } catch {
    return [];
  }
}

function save(sessionId: string, checkpoints: SessionCheckpoint[]): void {
  const path = storePath(sessionId);
  const body: CheckpointStore = { sessionId, checkpoints: checkpoints.slice(0, 50) };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

export function createCheckpoint(
  sessionId: string,
  input: { name: string; summary?: string; entryId?: string },
): SessionCheckpoint {
  const checkpoints = listCheckpoints(sessionId);
  const cp: SessionCheckpoint = {
    id: randomBytes(4).toString("hex"),
    name: input.name.trim().slice(0, 80) || "checkpoint",
    summary: (input.summary ?? "").trim().slice(0, 2000),
    entryId: input.entryId,
    createdAt: new Date().toISOString(),
  };
  checkpoints.unshift(cp);
  save(sessionId, checkpoints);
  return cp;
}

export function getCheckpoint(sessionId: string, id: string): SessionCheckpoint | null {
  return listCheckpoints(sessionId).find((c) => c.id === id || c.name === id) ?? null;
}

export function formatCheckpointsForAgent(items: SessionCheckpoint[]): string {
  if (items.length === 0) return "No checkpoints yet.";
  return items
    .map((c, i) => `${i + 1}. [${c.id}] ${c.name} @ ${c.createdAt}${c.entryId ? ` entry=${c.entryId}` : ""}\n   ${c.summary || "(no summary)"}`)
    .join("\n");
}
