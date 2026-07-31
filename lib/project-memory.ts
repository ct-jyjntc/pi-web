import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readWebSettings, type WebSettings } from "./web-settings";

/** Sync project root for memory keying (main + worktrees share when .git is found). */
function syncProjectRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (let i = 0; i < 40; i++) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      // Linked worktrees: .git is a file pointing at the main common dir.
      try {
        const st = readFileSync(gitPath, "utf8");
        const m = st.match(/gitdir:\s*(.+)/i);
        if (m?.[1]) {
          const gitDir = resolve(dir, m[1].trim());
          // .../main/.git/worktrees/<name> → main repo root is two levels up from worktrees
          const worktreesIdx = gitDir.replace(/\\/g, "/").lastIndexOf("/worktrees/");
          if (worktreesIdx !== -1) {
            const mainGit = gitDir.slice(0, worktreesIdx); // .../main/.git
            return dirname(mainGit);
          }
        }
      } catch {
        // fall through — treat as normal repo root
      }
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(cwd);
}

export type MemoryFact = {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  importance: number;
  source: "tool" | "user";
};

export type ProjectMemorySettings = {
  enabled: boolean;
  /**
   * When true, pi-web may auto-inject stored facts into the system prompt and
   * per-turn memory-context. Default false: prompts stay under pi-web control
   * only (no agent-written memory leaking into system prompt).
   */
  autoInject: boolean;
  autoInjectTopK: number;
  maxFactChars: number;
  maxInjectChars: number;
  /** Hard char budget for the project-scope store (see memoryStoreUsage). */
  projectBudgetChars: number;
};

export const DEFAULT_PROJECT_MEMORY: ProjectMemorySettings = {
  // Tools + store available only when enabled; never auto-inject by default.
  enabled: false,
  autoInject: false,
  autoInjectTopK: 12,
  maxFactChars: 400,
  maxInjectChars: 3000,
  projectBudgetChars: 4000,
};

export function parseProjectMemorySettings(value: unknown): ProjectMemorySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PROJECT_MEMORY };
  }
  const rec = value as Record<string, unknown>;
  const clamp = (n: unknown, fallback: number, min: number, max: number) => {
    const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
  };
  return {
    enabled: typeof rec.enabled === "boolean" ? rec.enabled : DEFAULT_PROJECT_MEMORY.enabled,
    // Missing key → false (prompt ownership). Only explicit true enables inject.
    autoInject: rec.autoInject === true,
    autoInjectTopK: clamp(rec.autoInjectTopK, DEFAULT_PROJECT_MEMORY.autoInjectTopK, 0, 50),
    maxFactChars: clamp(rec.maxFactChars, DEFAULT_PROJECT_MEMORY.maxFactChars, 80, 2000),
    maxInjectChars: clamp(rec.maxInjectChars, DEFAULT_PROJECT_MEMORY.maxInjectChars, 200, 12000),
    projectBudgetChars: clamp(rec.projectBudgetChars, DEFAULT_PROJECT_MEMORY.projectBudgetChars, 500, 20000),
  };
}

/** True when pi-web is allowed to push memory into model-visible prompts. */
export function memoryAutoInjectEnabled(settings: ProjectMemorySettings): boolean {
  return settings.enabled && settings.autoInject && settings.autoInjectTopK > 0;
}

/** Read + normalize project memory settings once (preferred call-site helper). */
export function getProjectMemorySettings(
  raw?: ProjectMemorySettings | WebSettings["projectMemory"] | null,
): ProjectMemorySettings {
  return parseProjectMemorySettings(raw ?? readWebSettings().projectMemory);
}

export function projectMemoryKey(cwd: string): string {
  const root = syncProjectRoot(cwd);
  return createHash("sha256").update(root).digest("hex").slice(0, 24);
}

export function projectMemoryDir(cwd: string): string {
  return join(getAgentDir(), "project-memory", projectMemoryKey(cwd));
}

/** Memory store is project-scoped only (no global/user memory). */
function factsPath(cwd: string): string {
  return join(projectMemoryDir(cwd), "facts.jsonl");
}

/**
 * Per-fact overhead charged against the scope budget — approximates the JSONL
 * envelope (id, timestamps, tags) that accompanies each fact's text.
 */
const FACT_OVERHEAD_CHARS = 20;

/** Hard cap on fact count per scope; the char budget is the primary guard. */
const MAX_FACTS_PER_SCOPE = 200;

/**
 * Store budget usage = Σ (fact.text.length + FACT_OVERHEAD_CHARS) over all
 * facts in the scope. A write is rejected when the FINAL state would exceed
 * the scope's budgetChars.
 */
export function memoryStoreUsage(facts: MemoryFact[]): number {
  return facts.reduce((sum, f) => sum + f.text.length + FACT_OVERHEAD_CHARS, 0);
}

export function memoryBudgetChars(settings: ProjectMemorySettings): number {
  return settings.projectBudgetChars;
}

function newId(): string {
  return randomBytes(4).toString("hex");
}

function parseFactLine(line: string): MemoryFact | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.text !== "string") return null;
    return {
      id: raw.id,
      text: raw.text,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      importance: typeof raw.importance === "number" ? raw.importance : 0.5,
      source: raw.source === "user" ? "user" : "tool",
    };
  } catch {
    return null;
  }
}

export function listMemoryFacts(cwd: string): MemoryFact[] {
  const path = factsPath(cwd);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const facts: MemoryFact[] = [];
  for (const line of lines) {
    const fact = parseFactLine(line);
    if (fact) facts.push(fact);
  }
  // Newest / highest importance first
  return facts.sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function writeAllFacts(cwd: string, facts: MemoryFact[]): void {
  const path = factsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const body = facts.map((f) => JSON.stringify(f)).join("\n") + (facts.length ? "\n" : "");
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

function cleanFactText(text: string, maxFactChars: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxFactChars);
}

// Soft secret guard
function assertNoSecrets(text: string): void {
  if (/(api[_-]?key|secret|password|token)\s*[:=]/i.test(text) || /sk-[a-zA-Z0-9]{10,}/.test(text)) {
    throw new Error("Refusing to store possible secrets in project memory");
  }
}

/**
 * Hermes-style consolidation instruction, quoted in every budget-overflow
 * error so the model can self-correct in the same turn.
 */
const CONSOLIDATE_INSTRUCTION =
  "Consolidate now: use 'replace' to merge overlapping entries or 'remove' to drop stale ones, " +
  "then retry this add — all in this turn. Prefer a single memory_retain call with an " +
  "operations array so removals and the new add land together.";

/** Entries echo for error messages (id + text; truncated when the store is huge). */
function formatEntriesForError(facts: MemoryFact[]): string {
  const MAX_ENTRIES = 30;
  const MAX_TEXT = 200;
  const lines = facts
    .slice(0, MAX_ENTRIES)
    .map((f) => `- [${f.id}] ${f.text.length > MAX_TEXT ? `${f.text.slice(0, MAX_TEXT)}…` : f.text}`);
  if (facts.length > MAX_ENTRIES) {
    lines.push(`… and ${facts.length - MAX_ENTRIES} more`);
  }
  return lines.join("\n");
}

function budgetOverflowError(
  facts: MemoryFact[],
  budget: number,
  context: { addingChars?: number; opsCount?: number; wouldBeChars?: number },
): Error {
  const usage = memoryStoreUsage(facts);
  const header = context.opsCount != null
    ? `After applying all ${context.opsCount} operations, project memory would be at ` +
      `${context.wouldBeChars}/${budget} chars — over the limit. Remove or shorten more ` +
      "entries in the same batch, then retry."
    : `project memory at ${usage}/${budget} chars. Adding this entry ` +
      `(${context.addingChars} chars) would exceed the limit.`;
  return new Error(
    `${header}\nCurrent entries:\n${formatEntriesForError(facts)}\n${CONSOLIDATE_INSTRUCTION}`,
  );
}

export function retainMemoryFact(
  cwd: string,
  text: string,
  options?: {
    tags?: string[];
    importance?: number;
    source?: "tool" | "user";
    settings?: ProjectMemorySettings;
  },
): MemoryFact {
  const settings = options?.settings ?? getProjectMemorySettings();
  const cleaned = cleanFactText(text, settings.maxFactChars);
  if (!cleaned) throw new Error("Memory fact text is empty");
  assertNoSecrets(cleaned);

  const now = new Date().toISOString();
  const facts = listMemoryFacts(cwd);
  // Dedupe by exact text
  const existing = facts.find((f) => f.text === cleaned);
  if (existing) {
    existing.updatedAt = now;
    existing.importance = Math.max(existing.importance, options?.importance ?? existing.importance);
    if (options?.tags?.length) {
      existing.tags = Array.from(new Set([...existing.tags, ...options.tags]));
    }
    writeAllFacts(cwd, facts);
    return existing;
  }

  const fact: MemoryFact = {
    id: newId(),
    text: cleaned,
    tags: options?.tags ?? [],
    createdAt: now,
    updatedAt: now,
    importance: options?.importance ?? 0.5,
    source: options?.source ?? "tool",
  };
  const budget = memoryBudgetChars(settings);
  if (memoryStoreUsage([fact, ...facts]) > budget) {
    throw budgetOverflowError(facts, budget, {
      addingChars: cleaned.length + FACT_OVERHEAD_CHARS,
    });
  }
  facts.unshift(fact);
  // Secondary count cap; the char budget above is the primary guard.
  writeAllFacts(cwd, facts.slice(0, MAX_FACTS_PER_SCOPE));
  return fact;
}

/**
 * Find the unique fact whose text CONTAINS `oldText` (case-insensitive).
 * Zero matches → error; multiple → error listing candidate ids + snippets.
 */
function findUniqueFact(facts: MemoryFact[], oldText: string, posPrefix?: string): MemoryFact {
  const needle = oldText.toLowerCase();
  const matches = facts.filter((f) => f.text.toLowerCase().includes(needle));
  const pos = posPrefix ? `${posPrefix}: ` : "";
  if (matches.length === 0) {
    throw new Error(`${pos}no memory entry matches "${oldText}".`);
  }
  if (matches.length > 1) {
    const candidates = matches
      .map((f) => `- [${f.id}] ${f.text.length > 120 ? `${f.text.slice(0, 120)}…` : f.text}`)
      .join("\n");
    throw new Error(
      `${pos}"${oldText}" matches ${matches.length} memory entries — be more specific. Candidates:\n${candidates}`,
    );
  }
  return matches[0];
}

export function replaceMemoryFact(
  cwd: string,
  oldText: string,
  newText: string,
  options?: { settings?: ProjectMemorySettings },
): MemoryFact {
  const settings = options?.settings ?? getProjectMemorySettings();
  const needle = oldText.trim();
  if (!needle) throw new Error("oldText is required");
  const cleaned = cleanFactText(newText, settings.maxFactChars);
  if (!cleaned) throw new Error("Memory fact text is empty");
  assertNoSecrets(cleaned);

  const facts = listMemoryFacts(cwd);
  const target = findUniqueFact(facts, needle);
  const replaced: MemoryFact = { ...target, text: cleaned, updatedAt: new Date().toISOString() };
  const next = facts.map((f) => (f.id === target.id ? replaced : f));
  const budget = memoryBudgetChars(settings);
  if (memoryStoreUsage(next) > budget) {
    throw budgetOverflowError(facts, budget, {
      addingChars: cleaned.length - target.text.length,
    });
  }
  writeAllFacts(cwd, next);
  return replaced;
}

export function removeMemoryFactByText(
  cwd: string,
  oldText: string,
): MemoryFact {
  const needle = oldText.trim();
  if (!needle) throw new Error("oldText is required");
  const facts = listMemoryFacts(cwd);
  const target = findUniqueFact(facts, needle);
  writeAllFacts(cwd, facts.filter((f) => f.id !== target.id));
  return target;
}

export type MemoryOperation = {
  action: "add" | "replace" | "remove";
  /** Fact text for add/replace. */
  text?: string;
  /** Unique substring of the entry to replace/remove. */
  oldText?: string;
};

/**
 * Apply a batch of add/replace/remove ops atomically (Hermes-style):
 * validate every op first, apply against an in-memory copy, check the budget
 * on the FINAL state only. On any failure NOTHING is written.
 */
export function applyMemoryOperations(
  cwd: string,
  ops: MemoryOperation[],
  options?: { settings?: ProjectMemorySettings },
): { facts: MemoryFact[]; changed: number } {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error("operations list is empty.");
  }
  const settings = options?.settings ?? getProjectMemorySettings();

  // Validate all ops before touching disk.
  ops.forEach((op, i) => {
    const pos = `Operation ${i + 1} (${op?.action ?? "unknown"})`;
    if (!op || (op.action !== "add" && op.action !== "replace" && op.action !== "remove")) {
      throw new Error(`${pos}: unknown action. Use add, replace, or remove.`);
    }
    if (op.action === "add" && !(op.text ?? "").trim()) {
      throw new Error(`${pos}: text is required.`);
    }
    if (op.action === "replace" && !(op.text ?? "").trim()) {
      throw new Error(`${pos}: text is required (use action='remove' to delete).`);
    }
    if ((op.action === "replace" || op.action === "remove") && !(op.oldText ?? "").trim()) {
      throw new Error(`${pos}: oldText is required.`);
    }
  });

  // Work on a copy; commit only if the whole batch applies and fits the budget.
  const current = listMemoryFacts(cwd);
  const working = current.map((f) => ({ ...f, tags: [...f.tags] }));
  let changed = 0;

  ops.forEach((op, i) => {
    const pos = `Operation ${i + 1} (${op.action})`;
    if (op.action === "add") {
      const cleaned = cleanFactText(op.text ?? "", settings.maxFactChars);
      assertNoSecrets(cleaned);
      if (working.some((f) => f.text === cleaned)) return; // idempotent skip
      const now = new Date().toISOString();
      working.unshift({
        id: newId(),
        text: cleaned,
        tags: [],
        createdAt: now,
        updatedAt: now,
        importance: 0.5,
        source: "tool",
      });
      changed++;
    } else if (op.action === "replace") {
      const cleaned = cleanFactText(op.text ?? "", settings.maxFactChars);
      assertNoSecrets(cleaned);
      const target = findUniqueFact(working, (op.oldText ?? "").trim(), pos);
      target.text = cleaned;
      target.updatedAt = new Date().toISOString();
      changed++;
    } else {
      const target = findUniqueFact(working, (op.oldText ?? "").trim(), pos);
      working.splice(working.indexOf(target), 1);
      changed++;
    }
  });

  // Budget check against the FINAL state only.
  const budget = memoryBudgetChars(settings);
  const usage = memoryStoreUsage(working);
  if (usage > budget) {
    throw budgetOverflowError(current, budget, { opsCount: ops.length, wouldBeChars: usage });
  }
  const committed = working.slice(0, MAX_FACTS_PER_SCOPE);
  writeAllFacts(cwd, committed);
  return { facts: committed, changed };
}

export function deleteMemoryFact(cwd: string, id: string): boolean {
  const facts = listMemoryFacts(cwd);
  const next = facts.filter((f) => f.id !== id);
  if (next.length === facts.length) return false;
  writeAllFacts(cwd, next);
  return true;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 2);
}

export function recallMemoryFacts(
  cwd: string,
  query: string,
  limit = 8,
): MemoryFact[] {
  const facts = listMemoryFacts(cwd);
  if (!query.trim()) return facts.slice(0, limit);
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return facts.slice(0, limit);

  const scored = facts.map((fact) => {
    const tokens = tokenize(`${fact.text} ${fact.tags.join(" ")}`);
    let hits = 0;
    for (const t of tokens) {
      if (qTokens.has(t)) hits += 1;
    }
    // Prefer higher importance on ties after real token matches.
    return { fact, hits, score: hits + fact.importance * 0.1 };
  });

  return scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.fact);
}

export function buildMemoryInjectBlock(
  cwd: string,
  settings?: ProjectMemorySettings | WebSettings["projectMemory"],
): string | null {
  const mem = getProjectMemorySettings(settings);
  // Prompt ownership: never inject unless pi-web settings explicitly allow it.
  if (!memoryAutoInjectEnabled(mem)) return null;

  const facts = listMemoryFacts(cwd).slice(0, mem.autoInjectTopK);
  if (facts.length === 0) return null;
  const lines = [
    "## Project memory (auto-loaded)",
    "Durable facts about this project. Prefer these over re-discovering the same conventions.",
    "",
  ];
  let used = lines.join("\n").length;
  for (const fact of facts) {
    const line = `- ${fact.text}`;
    if (used + line.length + 1 > mem.maxInjectChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length <= 3) return null;

  const guidance =
    "Use memory_retain to save durable project facts (environment, conventions, lessons — never secrets). " +
    "Use memory_recall to search project memory. Use memory_reflect for a synthesized mental model.";
  return [...lines, "", guidance].join("\n");
}

export type MemoryReflection = {
  mode: "heuristic" | "model";
  factCount: number;
  focus?: string;
  themes: Array<{ theme: string; count: number }>;
  tagGroups: Array<{ tag: string; count: number; samples: string[] }>;
  pillars: string[];
  summary: string;
  sourceFactIds: string[];
  model?: string;
};

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then",
  "use", "using", "used", "via", "are", "was", "were", "been", "have", "has",
  "not", "but", "also", "only", "just", "should", "must", "will", "can",
  "project", "file", "files", "code", "default", "true", "false", "null",
]);

/** Offline synthesis: cluster facts by tags + keyword themes (no model call). */
export function reflectMemoryHeuristic(
  cwd: string,
  options?: { focus?: string; limit?: number },
): MemoryReflection {
  const focus = options?.focus?.trim() || "";
  const limit = Math.min(80, Math.max(5, options?.limit ?? 40));
  const pool = focus
    ? recallMemoryFacts(cwd, focus, limit)
    : listMemoryFacts(cwd).slice(0, limit);

  const tagMap = new Map<string, MemoryFact[]>();
  const tokenCounts = new Map<string, number>();
  for (const fact of pool) {
    for (const tag of fact.tags.length ? fact.tags : ["(untagged)"]) {
      const list = tagMap.get(tag) ?? [];
      list.push(fact);
      tagMap.set(tag, list);
    }
    for (const t of tokenize(fact.text)) {
      if (STOP.has(t) || t.length < 3) continue;
      tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
    }
  }

  const themes = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([theme, count]) => ({ theme, count }));

  const tagGroups = [...tagMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([tag, facts]) => ({
      tag,
      count: facts.length,
      samples: facts.slice(0, 3).map((f) => f.text),
    }));

  const pillars = pool
    .slice()
    .sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map((f) => f.text);

  const lines = [
    `# Project memory reflection${focus ? ` (focus: ${focus})` : ""}`,
    `facts considered: ${pool.length}`,
    "",
    "## Pillars (high importance)",
    ...pillars.map((p, i) => `${i + 1}. ${p}`),
    "",
    "## Themes",
    themes.length
      ? themes.map((t) => `- ${t.theme} (${t.count})`).join("\n")
      : "- (none)",
    "",
    "## By tag",
    ...tagGroups.flatMap((g) => [
      `### ${g.tag} (${g.count})`,
      ...g.samples.map((s) => `- ${s}`),
    ]),
  ];

  return {
    mode: "heuristic",
    factCount: pool.length,
    focus: focus || undefined,
    themes,
    tagGroups,
    pillars,
    summary: lines.join("\n"),
    sourceFactIds: pool.map((f) => f.id),
  };
}

function formatReflectionMarkdown(r: MemoryReflection): string {
  return r.summary;
}

export { formatReflectionMarkdown };
