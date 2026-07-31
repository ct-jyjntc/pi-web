import {
  memoryAutoInjectEnabled,
  parseProjectMemorySettings,
  recallMemoryFacts,
  type MemoryFact,
} from "./project-memory";
import { readWebSettings } from "./web-settings";

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
 */
export function buildQueryMemoryContext(cwd: string, query: string): string | null {
  if (!query.trim()) return null;
  const settings = parseProjectMemorySettings(readWebSettings().projectMemory);
  // Only inject when pi-web auto-inject is on (not just "memory tools enabled").
  if (!memoryAutoInjectEnabled(settings)) return null;

  const budget = MAX_BLOCK_CHARS - FENCE_NOTE.length - "<memory-context>\n\n</memory-context>".length;
  const facts: MemoryFact[] = recallMemoryFacts(cwd, query, PER_SCOPE_LIMIT, "project");
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
