/**
 * Pure helpers for message rendering (time, previews, usage, stream t/s, thinking fetch cache).
 */
import type { MessageKey, TranslateParams } from "@/lib/i18n/messages";
import type {
  AgentMessage,
  AssistantMessage,
  AssistantContentBlock,
  CustomMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";
import { apiFetch } from "@/lib/api-transport";

export const USER_MSG_COLLAPSE_CHARS = 420;
export const USER_MSG_COLLAPSE_LINES = 8;

export type TFn = (key: MessageKey, params?: TranslateParams) => string;

const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

export function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = apiFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { thinking?: unknown };
    if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
    return data.thinking;
  }).catch((error) => {
    thinkingContentCache.delete(key);
    throw error;
  });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

export function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

export function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export function approxJsonLength(value: unknown, depth: number): number {
  if (typeof value === "string") return value.length + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (value === null || value === undefined) return 4;
  if (depth > 4 || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    let total = 2;
    for (const item of value) total += approxJsonLength(item, depth + 1) + 1;
    return total;
  }
  let total = 2;
  const record = value as Record<string, unknown>;
  for (const key in record) total += key.length + 4 + approxJsonLength(record[key], depth + 1);
  return total;
}

/** Approximate streamed character count behind the est-tokens / t-per-s readouts. */
export function estimateStreamChars(blocks: AssistantContentBlock[]): number {
  let chars = 0;
  for (const b of blocks) {
    if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
    else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
    else if (b.type === "toolCall") chars += approxJsonLength((b as ToolCallContent).input ?? {}, 0);
  }
  return chars;
}

/** CJK ideographs count ~1 token; latin/other stay ~4 chars/token. */
export function estimateTokensFromChars(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x3400 && code <= 0x9fff)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0x20000 && code <= 0x2ceaf)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.max(0, Math.round(cjk + other / 4));
}

export function estimateStreamTokens(blocks: AssistantContentBlock[]): number {
  let tokens = 0;
  for (const b of blocks) {
    if (b.type === "text") tokens += estimateTokensFromChars((b as TextContent).text ?? "");
    else if (b.type === "thinking") tokens += estimateTokensFromChars((b as ThinkingContent).thinking ?? "");
    else if (b.type === "toolCall") tokens += Math.round(approxJsonLength((b as ToolCallContent).input ?? {}, 0) / 4);
  }
  return tokens;
}

export const STREAM_TPS_WINDOW_MS = 2000;
export const STREAM_TPS_MIN_DT_S = 0.3;

export type StreamTpsSample = { t: number; tokens: number };

/**
 * Instantaneous estimated-token rate over a recent window.
 * Mutates `samples` as a small ring; null until `minDtS` of history exists.
 * A drop in `tokens` (identity change) resets the ring.
 */
export function slidingWindowTps(
  samples: StreamTpsSample[],
  now: number,
  tokens: number,
  windowMs = STREAM_TPS_WINDOW_MS,
  minDtS = STREAM_TPS_MIN_DT_S,
): number | null {
  const last = samples[samples.length - 1];
  if (last && tokens < last.tokens) samples.length = 0;
  samples.push({ t: now, tokens });
  while (samples.length > 2 && samples[1]!.t <= now - windowMs) {
    samples.shift();
  }
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const newest = samples[samples.length - 1]!;
  const dt = (newest.t - first.t) / 1000;
  if (dt < minDtS) return null;
  return (newest.tokens - first.tokens) / dt;
}

export function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

export function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatCustomType(type: string): string {
  return type || "extension";
}

export function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


/**
 * Dig into a nested args/input value for a short readable scalar to use as a
 * scaffold preview (URL, ref, filename, …). Never renders "[object Object]".
 */
function readableScalar(value: unknown, depth = 0): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || depth >= 2) return "";
  const entries = Object.entries(value as Record<string, unknown>);
  const preferred = ["url", "ref", "element", "target", "filename", "name", "text", "title", "label", "query"];
  for (const key of preferred) {
    const found = entries.find(([k]) => k === key);
    if (found) {
      const s = readableScalar(found[1], depth + 1);
      if (s) return s;
    }
  }
  for (const [, v] of entries) {
    const s = readableScalar(v, depth + 1);
    if (s) return s;
  }
  return "";
}

export function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // mcp wrapper: { server, tool, args } — preview the inner tool name.
  if ("tool" in input && typeof input.tool === "string") return input.tool.slice(0, 120);

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  // Subagent (and similar): prefer the short UI description over the long prompt.
  if ("description" in input && typeof input.description === "string" && input.description.trim()) {
    const type = typeof input.subagent_type === "string" ? input.subagent_type.trim() : "";
    const desc = input.description.trim();
    return (type ? `${type} · ${desc}` : desc).slice(0, 120);
  }
  if ("subagent_type" in input && typeof input.subagent_type === "string" && input.subagent_type.trim()) {
    return input.subagent_type.trim().slice(0, 120);
  }

  // Nested args object — dig for a readable scalar, never "[object Object]".
  return readableScalar(input[keys[0]]).slice(0, 120);
}

export function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  return parts.join(" · ");
}
