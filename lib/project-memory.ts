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
  autoInjectTopK: number;
  maxFactChars: number;
  maxInjectChars: number;
};

export const DEFAULT_PROJECT_MEMORY: ProjectMemorySettings = {
  enabled: true,
  autoInjectTopK: 12,
  maxFactChars: 400,
  maxInjectChars: 3000,
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
    autoInjectTopK: clamp(rec.autoInjectTopK, DEFAULT_PROJECT_MEMORY.autoInjectTopK, 0, 50),
    maxFactChars: clamp(rec.maxFactChars, DEFAULT_PROJECT_MEMORY.maxFactChars, 80, 2000),
    maxInjectChars: clamp(rec.maxInjectChars, DEFAULT_PROJECT_MEMORY.maxInjectChars, 200, 12000),
  };
}

export function projectMemoryKey(cwd: string): string {
  const root = syncProjectRoot(cwd);
  return createHash("sha256").update(root).digest("hex").slice(0, 24);
}

export function projectMemoryDir(cwd: string): string {
  return join(getAgentDir(), "project-memory", projectMemoryKey(cwd));
}

function factsPath(cwd: string): string {
  return join(projectMemoryDir(cwd), "facts.jsonl");
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

export function retainMemoryFact(
  cwd: string,
  text: string,
  options?: { tags?: string[]; importance?: number; source?: "tool" | "user"; settings?: ProjectMemorySettings },
): MemoryFact {
  const settings = options?.settings ?? parseProjectMemorySettings(readWebSettings().projectMemory);
  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, settings.maxFactChars);
  if (!cleaned) throw new Error("Memory fact text is empty");

  // Soft secret guard
  if (/(api[_-]?key|secret|password|token)\s*[:=]/i.test(cleaned) || /sk-[a-zA-Z0-9]{10,}/.test(cleaned)) {
    throw new Error("Refusing to store possible secrets in project memory");
  }

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
  facts.unshift(fact);
  // Cap store size
  writeAllFacts(cwd, facts.slice(0, 200));
  return fact;
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

export function recallMemoryFacts(cwd: string, query: string, limit = 8): MemoryFact[] {
  const facts = listMemoryFacts(cwd);
  if (!query.trim()) return facts.slice(0, limit);
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return facts.slice(0, limit);

  const scored = facts.map((fact) => {
    const tokens = tokenize(`${fact.text} ${fact.tags.join(" ")}`);
    let score = 0;
    for (const t of tokens) {
      if (qTokens.has(t)) score += 1;
    }
    // Prefer higher importance on ties
    score += fact.importance * 0.1;
    return { fact, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.fact);
}

export function buildMemoryInjectBlock(
  cwd: string,
  settings?: ProjectMemorySettings | WebSettings["projectMemory"],
): string | null {
  const mem = parseProjectMemorySettings(settings ?? readWebSettings().projectMemory);
  if (!mem.enabled || mem.autoInjectTopK <= 0) return null;
  const facts = listMemoryFacts(cwd).slice(0, mem.autoInjectTopK);
  if (facts.length === 0) return null;

  const lines = [
    "## Project memory (auto-loaded)",
    "Durable facts about this project. Prefer these over re-discovering the same conventions.",
    "Use memory_retain for new durable facts (no secrets). Use memory_recall to search.",
    "",
  ];
  let used = lines.join("\n").length;
  for (const fact of facts) {
    const line = `- ${fact.text}`;
    if (used + line.length + 1 > mem.maxInjectChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length <= 4) return null;
  return lines.join("\n");
}
