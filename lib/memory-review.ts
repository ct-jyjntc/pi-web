/**
 * Background memory review (adapted from Hermes' agent/background_review.py).
 *
 * After every REVIEW_INTERVAL-th user turn in a session, the recent transcript
 * is replayed to a cheap utility model with ONE completion asking which facts
 * are worth persisting. The JSON reply is validated and written
 * programmatically via retainMemoryFact — no tool loop. retainMemoryFact's
 * secret guard, exact-text dedupe, and per-scope char budget are the safety net.
 */
import type { AssistantMessage, Context, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import {
  pickUtilityCompleteReasoning,
  resolveUtilityModel,
  type ResolvedUtilityModel,
} from "./utility-model";
import { getRoleModelRef } from "./model-roles";
import {
  listMemoryFacts,
  parseProjectMemorySettings,
  retainMemoryFact,
  type MemoryScope,
  type ProjectMemorySettings,
} from "./project-memory";
import { buildSessionContext, getSessionEntries, resolveSessionPath } from "./session-reader";
import { readWebSettings, type ModelRef, type WebSettings } from "./web-settings";

export type MemoryReviewResult = {
  saved: Array<{ scope: MemoryScope; text: string }>;
  skipped: boolean;
  reason?: string;
};

/** Run the review once per this many user turns per session. */
const REVIEW_INTERVAL = 10;
const MAX_SNIPPETS = 10;
const MAX_TRANSCRIPT_CHARS = 6_000;
const MAX_SNIPPET_CHARS = 1_200;
const MAX_MEMORIES_PER_REVIEW = 5;
const MAX_FACT_TEXT_CHARS = 200;
/** Bound the per-session counter map so long-lived servers don't leak ids. */
const MAX_COUNT_ENTRIES = 256;

declare global {
  // Per-session user-turn cadence counter. A process restart (or dev
  // hot-reload) resets it — worst case a session is reviewed a few turns
  // earlier than the interval, which is harmless.
  var __piMemoryReviewTurnCounts: Map<string, number> | undefined;
}

function getTurnCounts(): Map<string, number> {
  if (!globalThis.__piMemoryReviewTurnCounts) globalThis.__piMemoryReviewTurnCounts = new Map();
  return globalThis.__piMemoryReviewTurnCounts;
}

type CompleteSimpleFn = (
  model: Model<string>,
  context: Context,
  options?: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxRetries?: number;
    cacheRetention?: "none" | "short" | "long";
    reasoning?: ThinkingLevel;
  },
) => Promise<AssistantMessage>;

function getText(message: AssistantMessage): string {
  return message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => (
      typeof b === "object" && b !== null && (b as { type?: string }).type === "text"
        && typeof (b as { text?: unknown }).text === "string"
    ))
    .map((b) => b.text)
    .join("\n");
}

/** Last ~10 user/assistant text snippets on the active branch, ~6KB total. */
async function readRecentTranscript(sessionId: string): Promise<string> {
  const path = await resolveSessionPath(sessionId);
  if (!path) return "";
  const { messages } = buildSessionContext(getSessionEntries(path));
  const snippets: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && snippets.length < MAX_SNIPPETS; i--) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = messageText(m.content).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const budget = Math.min(MAX_SNIPPET_CHARS, MAX_TRANSCRIPT_CHARS - total);
    if (budget <= 0) break;
    const clipped = text.length > budget ? `${text.slice(0, budget)}…` : text;
    snippets.unshift(`${m.role === "user" ? "User" : "Assistant"}: ${clipped}`);
    total += clipped.length;
  }
  return snippets.join("\n\n");
}

/**
 * smol role first, then the advisor-style plan → default chain. A configured
 * but unavailable role model falls through to the next one instead of failing
 * the review; the last resort is the settings default / first available model.
 */
async function resolveReviewModel(cwd: string, prefs: WebSettings): Promise<ResolvedUtilityModel> {
  const refs: Array<ModelRef | null> = [
    getRoleModelRef("smol", prefs),
    getRoleModelRef("plan", prefs),
    getRoleModelRef("default", prefs),
  ];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref) continue;
    const key = `${ref.provider}/${ref.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      return await resolveUtilityModel(cwd, ref);
    } catch {
      // configured but unavailable — try the next role
    }
  }
  return resolveUtilityModel(cwd, null);
}

const REVIEW_SYSTEM_PROMPT = [
  "You are a silent memory curator reviewing an excerpt from a coding-agent conversation.",
  "Decide whether the excerpt revealed facts worth persisting for future sessions:",
  '- target "user": who the user is — persona, preferences, expectations, working style.',
  '- target "project": durable project conventions, environment facts, or hard-won lessons.',
  'Reply with ONLY JSON: {"memories":[{"target":"user"|"project","text":"...","tags":["..."],"importance":0.5}]}',
  "Rules:",
  '- Most excerpts contain nothing worth saving; reply {"memories":[]} in that case.',
  "One idea per memory, text ≤ 200 characters, at most 5 memories, 1-3 short tags each.",
  "importance is 0.1-1.0 (default 0.5).",
  "SKIP: transient errors, task progress, completed-work logs, temporary state,",
  "secrets/credentials, and facts easily re-discovered from the repo (file paths,",
  "dependencies, scripts visible in the tree).",
  "Write memories in the user's language. No markdown fences, no commentary.",
].join("\n");

type ReviewCandidate = { target: MemoryScope; text: string; tags: string[]; importance: number };

/** Defensive parse: strip fences, brace-slice, validate every field. */
function parseReviewResponse(raw: string): ReviewCandidate[] {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const memories = (parsed as { memories?: unknown }).memories;
  if (!Array.isArray(memories)) return [];
  const out: ReviewCandidate[] = [];
  for (const item of memories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const target: MemoryScope | null = rec.target === "user" ? "user" : rec.target === "project" ? "project" : null;
    const factText = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!target || !factText) continue;
    const tags = Array.isArray(rec.tags)
      ? rec.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : [];
    const importance = typeof rec.importance === "number" && Number.isFinite(rec.importance)
      ? Math.min(1, Math.max(0, rec.importance))
      : 0.5;
    out.push({ target, text: factText.slice(0, MAX_FACT_TEXT_CHARS), tags, importance });
    if (out.length >= MAX_MEMORIES_PER_REVIEW) break;
  }
  return out;
}

/** Mirror of project-memory's cleanFactText, used for pre-write dedupe. */
function cleanFactText(text: string, settings: ProjectMemorySettings): string {
  return text.replace(/\s+/g, " ").trim().slice(0, settings.maxFactChars);
}

export async function runMemoryReview(opts: { cwd: string; sessionId: string }): Promise<MemoryReviewResult> {
  const { cwd, sessionId } = opts;
  const prefs = readWebSettings();
  const memSettings = parseProjectMemorySettings(prefs.projectMemory);
  if (!memSettings.enabled) return { saved: [], skipped: true, reason: "disabled" };

  // Cadence: count user turns per session; only every Nth runs the review.
  const counts = getTurnCounts();
  const turn = (counts.get(sessionId) ?? 0) + 1;
  counts.delete(sessionId); // refresh insertion order for the eviction below
  counts.set(sessionId, turn);
  if (counts.size > MAX_COUNT_ENTRIES) {
    const oldest = counts.keys().next();
    if (!oldest.done) counts.delete(oldest.value);
  }
  if (turn % REVIEW_INTERVAL !== 0) return { saved: [], skipped: true, reason: "cadence" };

  const transcript = await readRecentTranscript(sessionId);
  if (!transcript) return { saved: [], skipped: true, reason: "no-transcript" };

  const resolved = await resolveReviewModel(cwd, prefs);
  const completeSimple = resolved.modelRuntime.completeSimple.bind(
    resolved.modelRuntime,
  ) as CompleteSimpleFn;
  const reasoning = pickUtilityCompleteReasoning(resolved.model);

  const response = await completeSimple(resolved.model, {
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Recent conversation excerpt (oldest first):\n\n${transcript}`,
      timestamp: Date.now(),
    }],
  }, {
    maxTokens: 600,
    temperature: 0.2,
    timeoutMs: 60_000,
    maxRetries: 0,
    cacheRetention: "none",
    ...(reasoning ? { reasoning } : {}),
  });

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    return { saved: [], skipped: true, reason: "model-error" };
  }

  const candidates = parseReviewResponse(getText(response));
  const saved: Array<{ scope: MemoryScope; text: string }> = [];
  const seenTexts = new Set<string>();
  for (const candidate of candidates) {
    const cleaned = cleanFactText(candidate.text, memSettings);
    if (!cleaned) continue;
    const dedupeKey = `${candidate.target}:${cleaned.toLowerCase()}`;
    if (seenTexts.has(dedupeKey)) continue;
    seenTexts.add(dedupeKey);
    // Exact-text duplicates are already stored; skip quietly instead of
    // counting retainMemoryFact's dedupe-touch as a fresh save.
    if (listMemoryFacts(cwd, candidate.target).some((f) => f.text === cleaned)) continue;
    try {
      const fact = retainMemoryFact(cwd, cleaned, {
        tags: candidate.tags,
        importance: candidate.importance,
        source: "tool",
        scope: candidate.target,
        settings: memSettings,
      });
      saved.push({ scope: candidate.target, text: fact.text });
    } catch {
      // Secret guard or budget overflow: drop this fact, keep the rest.
    }
  }
  return { saved, skipped: false };
}
