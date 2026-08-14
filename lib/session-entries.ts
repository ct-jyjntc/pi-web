/**
 * Parsed session entries + UI context, built on the pi SDK.
 *
 * Split out of session-reader.ts on purpose: importing the agent SDK cost ~36s
 * on a cold Windows install, and it was sitting on the /api/sessions path even
 * though listing archives only reads .jsonl off disk. session-reader.ts must
 * stay SDK-free so the session list renders before the SDK is ever needed.
 */
import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
} from "@earendil-works/pi-coding-agent";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { statSync } from "fs";
import type { AgentMessage, SessionContext, SessionEntry } from "./types";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./session-path";
import { isRecord } from "./type-guards";
import { attachPresentationToMessages } from "./tool-presentation";

declare global {
  var __piSessionEntriesCache: Map<string, SessionEntriesCacheEntry> | undefined;
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
    messages: attachPresentationToMessages(messages),
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
