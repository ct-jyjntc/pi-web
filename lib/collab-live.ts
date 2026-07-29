/**
 * Collab-lite live read-only sharing: token → session file tail over SSE.
 */
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type CollabShare = {
  token: string;
  sessionId: string;
  sessionFile?: string;
  note?: string;
  createdAt: string;
  mode: "read-only";
};

function storeDir(): string {
  const dir = join(getAgentDir(), "collab");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sharePath(token: string): string {
  return join(storeDir(), `${token}.json`);
}

export function createCollabShare(input: {
  sessionId: string;
  sessionFile?: string;
  note?: string;
}): CollabShare {
  const token = createHash("sha256")
    .update(`${input.sessionId}:${Date.now()}:${randomBytes(8).toString("hex")}`)
    .digest("hex")
    .slice(0, 24);
  const share: CollabShare = {
    token,
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    note: input.note,
    createdAt: new Date().toISOString(),
    mode: "read-only",
  };
  writeFileSync(sharePath(token), `${JSON.stringify(share, null, 2)}\n`, "utf8");
  return share;
}

export function getCollabShare(token: string): CollabShare | null {
  const p = sharePath(token);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CollabShare;
  } catch {
    return null;
  }
}

export function readSessionSnapshot(sessionFile: string, maxBytes = 2_000_000): {
  exists: boolean;
  size: number;
  mtimeMs: number;
  /** Full content when under maxBytes; otherwise last maxBytes (still large enough for long chats). */
  content: string;
  truncated: boolean;
  /** @deprecated use content */
  tail: string;
} {
  if (!sessionFile || !existsSync(sessionFile)) {
    return { exists: false, size: 0, mtimeMs: 0, content: "", truncated: false, tail: "" };
  }
  const st = statSync(sessionFile);
  const buf = readFileSync(sessionFile);
  const truncated = buf.byteLength > maxBytes;
  const slice = truncated ? buf.subarray(buf.byteLength - maxBytes) : buf;
  // If truncated mid-line, drop the first partial line so JSONL stays parseable.
  let text = slice.toString("utf8");
  if (truncated) {
    const nl = text.indexOf("\n");
    if (nl !== -1) text = text.slice(nl + 1);
  }
  return {
    exists: true,
    size: st.size,
    mtimeMs: st.mtimeMs,
    content: text,
    truncated,
    tail: text,
  };
}
