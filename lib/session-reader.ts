import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
} from "@earendil-works/pi-coding-agent";
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join, normalize as normalizePath } from "path";
import { createInterface } from "readline";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "./agent-dir";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";
import { isRecord } from "./type-guards";

// ============================================================================
// Session archive index.
//
// SessionManager.listAll() re-streams and re-parses every archive on every call
// (~180ms / 68MB locally). Session .jsonl files are append-only, so a per-file
// size+mtime signature is enough to reuse the previous parse and only touch the
// archives that actually changed — usually just the live session.
// ============================================================================

/** A session archive on disk, with the stat fields used as a cache signature. */
export type SessionFileStat = {
  path: string;
  size: number;
  mtimeMs: number;
};

/** Per-file facts pi-web needs out of an archive. Mirrors the SDK's internal
 *  buildSessionInfo() minus allMessagesText, which nothing here reads and which
 *  would pin tens of MB per session in the cache. */
type SessionFileFacts = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
};

type SessionFactsCacheEntry = { sig: string; facts: SessionFileFacts | null };

/** Matches SessionManager.listAll()'s concurrency. */
const SESSION_FACTS_CONCURRENCY = 10;

function sessionFileSignature(file: SessionFileStat): string {
  return `${file.size}:${Math.round(file.mtimeMs)}`;
}

function getSessionFactsCache(): Map<string, SessionFactsCacheEntry> {
  if (!globalThis.__piSessionFactsCache) globalThis.__piSessionFactsCache = new Map();
  return globalThis.__piSessionFactsCache;
}

/** List session archives at <sessionsDir>/<project>/<session>.jsonl. This mirrors
 *  SessionManager.listAll()'s traversal exactly: two levels, no recursion into the
 *  per-session directories that hold subagent task logs. */
export async function listSessionFiles(): Promise<SessionFileStat[]> {
  const sessionsDir = join(getAgentDir(), "sessions");
  if (!existsSync(sessionsDir)) return [];

  let projectDirs: string[];
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => join(sessionsDir, e.name));
  } catch {
    return [];
  }

  const perDir = await Promise.all(projectDirs.map(async (dir) => {
    try {
      const names = await readdir(dir);
      return names.filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name));
    } catch {
      return [];
    }
  }));

  const stats = await Promise.all(perDir.flat().map(async (path): Promise<SessionFileStat | null> => {
    try {
      const st = await stat(path);
      return { path, size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }));
  return stats.filter((file): file is SessionFileStat => file !== null);
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Skip malformed lines, like the SDK's parseSessionEntryLine.
    return null;
  }
}

/** Last activity timestamp of a message entry (SDK: getMessageActivityTime). */
function messageActivityTime(entry: Record<string, unknown>): number | undefined {
  const message = entry.message;
  if (!isRecord(message) || !("content" in message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  if (typeof message.timestamp === "number") return message.timestamp;
  const parsed = new Date(entry.timestamp as string).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Concatenated text blocks of a message (SDK: extractTextContent). */
function messageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join(" ");
}

/** Stream one archive for its index facts. Returns null for archives the SDK also
 *  skips (no leading session header). */
async function readSessionFileFacts(file: SessionFileStat): Promise<SessionFileFacts | null> {
  let header: SessionHeader | null = null;
  let messageCount = 0;
  let firstMessage = "";
  let name: string | undefined;
  let lastActivityTime: number | undefined;

  const input = createReadStream(file.path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const entry = parseJsonLine(line);
      if (!entry) continue;

      if (!header) {
        // A non-header first entry means a corrupt archive; the SDK drops it too.
        if (entry.type !== "session" || typeof entry.id !== "string") return null;
        header = entry as unknown as SessionHeader;
        continue;
      }

      // Session name: latest session_info entry wins, including explicit clears.
      if (entry.type === "session_info") {
        name = (typeof entry.name === "string" ? entry.name.trim() : "") || undefined;
      }
      if (entry.type !== "message") continue;

      messageCount += 1;
      const activityTime = messageActivityTime(entry);
      if (typeof activityTime === "number") {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }

      if (firstMessage) continue;
      const message = entry.message;
      if (!isRecord(message) || !("content" in message) || message.role !== "user") continue;
      firstMessage = messageText(message);
    }
  } catch {
    return null;
  } finally {
    // Returning early from the loop leaves the fd open unless the stream is
    // destroyed explicitly (rl.close() only tears down the line reader).
    rl.close();
    input.destroy();
  }
  if (!header) return null;

  // created/modified are serialized with toISOString() below, so never leave an
  // invalid Date here: fall back to the file's mtime like the SDK does.
  const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : Number.NaN;
  const created = Number.isNaN(headerTime) ? new Date(file.mtimeMs) : new Date(headerTime);
  return {
    path: file.path,
    id: header.id,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    name,
    parentSessionPath: header.parentSession,
    created,
    modified: typeof lastActivityTime === "number" && lastActivityTime > 0 ? new Date(lastActivityTime) : created,
    messageCount,
    firstMessage: firstMessage || "(no messages)",
  };
}

async function listSessionFacts(): Promise<SessionFileFacts[]> {
  const files = await listSessionFiles();
  const cache = getSessionFactsCache();
  const live = new Set<string>();
  const dirty: SessionFileStat[] = [];

  for (const file of files) {
    live.add(file.path);
    if (cache.get(file.path)?.sig !== sessionFileSignature(file)) dirty.push(file);
  }
  // Drop entries for archives that no longer exist.
  for (const key of cache.keys()) {
    if (!live.has(key)) cache.delete(key);
  }

  // Only re-stream archives whose size/mtime changed. Failed reads are cached as
  // null so a corrupt archive is not re-streamed on every refresh either.
  const workers = Array.from({ length: SESSION_FACTS_CONCURRENCY }, async () => {
    for (;;) {
      const file = dirty.shift();
      if (!file) return;
      const facts = await readSessionFileFacts(file);
      cache.set(file.path, { sig: sessionFileSignature(file), facts });
    }
  });
  await Promise.all(workers);

  const facts: SessionFileFacts[] = [];
  for (const file of files) {
    const hit = cache.get(file.path);
    if (hit?.facts) facts.push(hit.facts);
  }
  facts.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return facts;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const sessions: SessionFileFacts[] = await listSessionFacts();
  const pathToId = new Map<string, string>();
  for (const s of sessions) pathToId.set(sessionPathKey(s.path), s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__piSessionListGeneration ?? 0) === generation) {
      globalThis.__piSessionListCache = { data, ts: Date.now() };
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
  var __piSessionFactsCache: Map<string, SessionFactsCacheEntry> | undefined;
  var __piSessionPathRescan: SessionPathRescan | undefined;
  var __piMissingSessionIds: Map<string, number> | undefined;
  var __piSessionEntriesCache: Map<string, SessionEntriesCacheEntry> | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

/** Negative cache for ids confirmed absent from disk. Long enough to absorb an
 *  SSE 404 reconnect loop, short enough that an externally created session shows
 *  up almost immediately. */
const MISSING_SESSION_TTL_MS = 2_000;
/** Unknown ids arrive straight from URLs, so bound the negative cache. */
const MISSING_SESSION_MAX_ENTRIES = 256;

type SessionPathRescan = { promise: Promise<void>; startedAt: number };

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
  // A mutation may have created the very id we last reported as missing.
  globalThis.__piMissingSessionIds?.clear();
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

function getMissingSessionCache(): Map<string, number> {
  if (!globalThis.__piMissingSessionIds) globalThis.__piMissingSessionIds = new Map();
  return globalThis.__piMissingSessionIds;
}

function isKnownMissingSession(sessionId: string): boolean {
  const cache = getMissingSessionCache();
  const at = cache.get(sessionId);
  if (at === undefined) return false;
  if (Date.now() - at < MISSING_SESSION_TTL_MS) return true;
  cache.delete(sessionId);
  return false;
}

function rememberMissingSession(sessionId: string): void {
  const cache = getMissingSessionCache();
  cache.delete(sessionId);
  cache.set(sessionId, Date.now());
  while (cache.size > MISSING_SESSION_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Force one shared disk rescan for path resolution. Invalidating per caller
 *  would defeat listAllSessions()'s in-flight coalescing (each bumped generation
 *  starts its own scan), so concurrent path misses share this promise instead. */
function rescanSessionPaths(): SessionPathRescan {
  const running = globalThis.__piSessionPathRescan;
  if (running) return running;

  const startedAt = Date.now();
  invalidateSessionListCache();
  const promise = listAllSessions().then(() => undefined).finally(() => {
    if (globalThis.__piSessionPathRescan?.promise === promise) {
      globalThis.__piSessionPathRescan = undefined;
    }
  });
  const rescan: SessionPathRescan = { promise, startedAt };
  globalThis.__piSessionPathRescan = rescan;
  return rescan;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) {
    if (existsSync(cached)) return cached;
    // Stale path (deleted file / never flushed) — drop and rescan.
    invalidateSessionPathCache(sessionId);
  }

  // Ids we just failed to find would otherwise force a full rescan per request.
  if (isKnownMissingSession(sessionId)) return null;

  // Path miss must hit disk even when the session-list TTL is still warm;
  // otherwise a session created outside this process is invisible for up to 30s.
  const requestedAt = Date.now();
  let scan = rescanSessionPaths();
  await scan.promise;
  let resolved = getPathCache().get(sessionId) ?? null;

  if (!resolved && scan.startedAt < requestedAt) {
    // The shared scan started before this request, so it may predate the file.
    // Every rescan from here on starts after requestedAt, so one retry suffices.
    scan = rescanSessionPaths();
    await scan.promise;
    resolved = getPathCache().get(sessionId) ?? null;
  }

  if (resolved && !existsSync(resolved)) {
    invalidateSessionPathCache(sessionId);
    resolved = null;
  }
  if (!resolved) rememberMissingSession(sessionId);
  return resolved;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
  getMissingSessionCache().delete(sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

// ============================================================================
// Parsed-entry cache.
//
// SessionManager.open().getEntries() is fully synchronous (~55ms for a 26MB
// archive), so every uncached call blocks the event loop for the whole server.
// Archives are append-only, so an unchanged size+mtime signature guarantees
// unchanged content. Entries expand to several times the file size in heap, so
// the LRU is bounded by both count and raw bytes.
// ============================================================================
// The SessionManager instance is cached alongside the entries because `getTree()`
// needs `labelsById`, which only exists on the instance and is built during the
// parse. `getEntries()` re-filters `fileEntries` on every call, so its result is
// memoized separately; both views reference the same entry objects, so holding
// the instance costs only the index maps on top of what `entries` already pins.
type SessionEntriesCacheEntry = {
  sig: string;
  bytes: number;
  manager: ReturnType<typeof SessionManager.open>;
  entries: SessionEntry[];
};

const ENTRIES_CACHE_MAX_FILES = 4;
const ENTRIES_CACHE_MAX_BYTES = 64 * 1024 * 1024;

function getEntriesCache(): Map<string, SessionEntriesCacheEntry> {
  if (!globalThis.__piSessionEntriesCache) globalThis.__piSessionEntriesCache = new Map();
  return globalThis.__piSessionEntriesCache;
}

function statEntriesSignature(filePath: string): { sig: string; bytes: number } | null {
  try {
    const st = statSync(filePath);
    return { sig: `${st.size}:${Math.round(st.mtimeMs)}`, bytes: st.size };
  } catch {
    return null;
  }
}

/** Evict oldest insertions until both budgets hold. The newest entry is always
 *  kept, even when it alone exceeds the byte budget — it is the one whose reparse
 *  costs the most. */
function pruneEntriesCache(cache: Map<string, SessionEntriesCacheEntry>): void {
  let bytes = 0;
  for (const entry of cache.values()) bytes += entry.bytes;
  while (cache.size > 1 && (cache.size > ENTRIES_CACHE_MAX_FILES || bytes > ENTRIES_CACHE_MAX_BYTES)) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    bytes -= cache.get(oldest.value)?.bytes ?? 0;
    cache.delete(oldest.value);
  }
}

/**
 * Cached `SessionManager` for read-only access. Callers that mutate the archive
 * (`appendSessionInfo`, fork, live AgentSessions) must keep opening their own
 * instance: a mutation would desync this one from every other reader holding it
 * until the next size/mtime change.
 */
export function getSessionManager(filePath: string): ReturnType<typeof SessionManager.open> {
  return openCachedSession(filePath).manager;
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  return openCachedSession(filePath).entries;
}

function openCachedSession(filePath: string): { manager: ReturnType<typeof SessionManager.open>; entries: SessionEntry[] } {
  const cacheKey = sessionPathKey(filePath);
  const cache = getEntriesCache();
  const signature = statEntriesSignature(filePath);

  if (signature) {
    const hit = cache.get(cacheKey);
    if (hit && hit.sig === signature.sig) {
      // Re-insert to refresh LRU recency.
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit;
    }
  }

  const manager = SessionManager.open(filePath);
  const entries = manager.getEntries() as unknown as SessionEntry[];
  if (!signature) return { manager, entries };

  cache.delete(cacheKey);
  cache.set(cacheKey, { sig: signature.sig, bytes: signature.bytes, manager, entries });
  pruneEntriesCache(cache);
  return { manager, entries };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      const content = Array.isArray(message.content) ? message.content : [];
      return {
        ...message,
        content: content.map((block) => (
          block.type === "thinking"
            && typeof (block as { thinking?: unknown }).thinking === "string"
            && (block as { thinking: string }).thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}

/**
 * Undo the defer transforms for token estimation only.
 *
 * The client always asks for deferred thinking/media, but the usage number must
 * reflect the full history. Rebuilding the context a second time without the
 * defer flags re-walks every entry in the archive; instead, restore each context
 * slot from its source entry: buildSessionContext renders a `message` entry as
 * exactly `normalizeToolCalls(entry.message)` when nothing is deferred, and
 * `entryIds[i]` is parallel to `messages[i]`. Non-message entries (compaction,
 * branch summaries, custom messages) are never deferred, so they pass through.
 */
export function restoreDeferredMessages(
  context: SessionContext,
  entries: SessionEntry[],
): AgentMessage[] {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return context.messages.map((message, index) => {
    const entry = byId.get(context.entryIds[index]);
    return entry?.type === "message" ? normalizeToolCalls(entry.message) : message;
  });
}
