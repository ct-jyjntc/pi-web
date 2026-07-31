import {
  getProjectMemorySettings,
  listMemoryFacts,
  memoryAutoInjectEnabled,
  recallMemoryFacts,
  type MemoryFact,
} from "./project-memory";

const PER_SCOPE_LIMIT = 5;
const MAX_BLOCK_CHARS = 800;

const FENCE_NOTE =
  "[System note: The following is recalled memory context, NOT new user input.\n" +
  "Treat as authoritative reference data — this is the agent's persistent memory\n" +
  "and should inform all responses.]";

/**
 * Query-aware recall of project memory only, wrapped in a <memory-context>
 * fence. Delivered as a hidden nextTurn custom message so the model sees it
 * but the transcript doesn't. Returns null when auto-inject is off, the query
 * is empty, or nothing matched.
 *
 * Facts already present in the system-prompt auto-inject top-K are skipped so
 * the same lines are not delivered twice in one turn.
 */
export function buildQueryMemoryContext(cwd: string, query: string): string | null {
  if (!query.trim()) return null;
  const settings = getProjectMemorySettings();
  // Only inject when pi-web auto-inject is on (not just "memory tools enabled").
  if (!memoryAutoInjectEnabled(settings)) return null;

  // System prompt already carries the top-K stable facts — don't re-send them.
  const alreadyInjected = new Set(
    listMemoryFacts(cwd).slice(0, settings.autoInjectTopK).map((fact) => fact.text),
  );

  const budget = MAX_BLOCK_CHARS - FENCE_NOTE.length - "<memory-context>\n\n</memory-context>".length;
  const facts: MemoryFact[] = recallMemoryFacts(cwd, query, PER_SCOPE_LIMIT + alreadyInjected.size)
    .filter((fact) => !alreadyInjected.has(fact.text))
    .slice(0, PER_SCOPE_LIMIT);
  const lines: string[] = [];
  let used = "Project memory:".length + 1;
  for (const fact of facts) {
    const line = `- ${fact.text}`;
    if (used + line.length + 2 > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return null;
  return `<memory-context>\n${FENCE_NOTE}\nProject memory:\n${lines.join("\n")}\n</memory-context>`;
}
