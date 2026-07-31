import { parseProjectMemorySettings, recallMemoryFacts, type MemoryFact, type MemoryScope } from "./project-memory";
import { readWebSettings } from "./web-settings";

const PER_SCOPE_LIMIT = 5;
const MAX_BLOCK_CHARS = 800;

const FENCE_NOTE =
  "[System note: The following is recalled memory context, NOT new user input.\n" +
  "Treat as authoritative reference data — this is the agent's persistent memory\n" +
  "and should inform all responses.]";

const SCOPE_TITLES: Record<MemoryScope, string> = {
  project: "Project memory:",
  user: "User memory:",
};

/**
 * Hermes-style query-aware recall: facts relevant to the outgoing user message
 * from both memory scopes, wrapped in a <memory-context> fence. Delivered as a
 * hidden nextTurn custom message so the model sees it but the transcript doesn't.
 * Returns null when memory is disabled, the query is empty, or nothing matched.
 */
export function buildQueryMemoryContext(cwd: string, query: string): string | null {
  if (!query.trim()) return null;
  const settings = parseProjectMemorySettings(readWebSettings().projectMemory);
  if (!settings.enabled) return null;

  const budget = MAX_BLOCK_CHARS - FENCE_NOTE.length - "<memory-context>\n\n</memory-context>".length;
  const sections: string[] = [];
  let used = 0;
  for (const scope of ["project", "user"] as MemoryScope[]) {
    const facts: MemoryFact[] = recallMemoryFacts(cwd, query, PER_SCOPE_LIMIT, scope);
    const lines: string[] = [];
    let sectionUsed = SCOPE_TITLES[scope].length + 1;
    for (const fact of facts) {
      const line = `- ${fact.text}`;
      // +2: newline joining this section into the block + the line's own newline
      if (used + sectionUsed + line.length + 2 > budget) break;
      lines.push(line);
      sectionUsed += line.length + 1;
    }
    if (lines.length === 0) continue;
    sections.push([SCOPE_TITLES[scope], ...lines].join("\n"));
    used += sectionUsed + 1;
  }
  if (sections.length === 0) return null;
  return `<memory-context>\n${FENCE_NOTE}\n${sections.join("\n")}\n</memory-context>`;
}
