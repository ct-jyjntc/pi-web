/**
 * Project + user memory tools for Pi Web sessions.
 * Storage lives under ~/.pi/agent/project-memory/ and ~/.pi/agent/user-memory/
 * (not in the user repo).
 */
import { Type } from "typebox";
import {
  applyMemoryOperations,
  buildMemoryInjectBlock,
  deleteMemoryFact,
  listMemoryFacts,
  memoryBudgetChars,
  memoryStoreUsage,
  parseProjectMemorySettings,
  recallMemoryFacts,
  reflectMemoryHeuristic,
  retainMemoryFact,
  type MemoryFact,
  type MemoryOperation,
  type MemoryScope,
  type ProjectMemorySettings,
} from "./project-memory";
import { runMemoryReflect } from "./memory-reflect";
import { readWebSettings } from "./web-settings";

type ToolDefinitionLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
    isError?: boolean;
  }>;
};

function memorySettings() {
  return parseProjectMemorySettings(readWebSettings().projectMemory);
}

function disabledResult() {
  return {
    content: [{ type: "text" as const, text: "Project memory is disabled in Settings." }],
    isError: true,
  };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function pickScope(raw: unknown): MemoryScope {
  return raw === "user" ? "user" : "project";
}

/** Terminal success message — confirms the write landed and tells the model to stop. */
function writeSavedMessage(
  scope: MemoryScope,
  facts: MemoryFact[],
  settings: ProjectMemorySettings,
): string {
  const used = memoryStoreUsage(facts);
  const budget = memoryBudgetChars(settings, scope);
  return (
    `Write saved (${scope} memory, ${facts.length} facts, ${used}/${budget} chars). ` +
    "This update is complete — do not repeat it."
  );
}

export function createProjectMemoryTools(cwd: string): ToolDefinitionLike[] {
  const retain: ToolDefinitionLike = {
    name: "memory_retain",
    label: "memory_retain",
    description:
      "Save durable memory for future sessions. Routing: target='user' for who the user is " +
      "(name, role, preferences, style); target='project' (default) for environment, " +
      "conventions, tool quirks, lessons. WHEN: the user states a preference, correction, or " +
      "personal detail, or you learn a stable fact about their setup. Priority: user " +
      "preferences & corrections > environment facts > procedures. SKIP: trivial or easily " +
      "re-discovered info, task progress, temporary TODOs, raw dumps, secrets. " +
      "Pass operations[] for an atomic add/replace/remove batch (entries addressed by unique " +
      "substring via oldText); the char budget is checked on the final state only. " +
      "IF FULL: the write is rejected with all current entries — reissue ONE call with " +
      "operations[] that removes/shortens stale entries AND adds the new one together.",
    promptSnippet: "Save a durable user or project memory (success is terminal — do not repeat)",
    promptGuidelines: [
      "WHEN to save: user states a preference/correction/personal detail, or you learn a stable environment/convention fact. Priority: user preferences & corrections > environment facts > procedures.",
      "Routing: target='user' = who the user is; target='project' = environment, conventions, lessons.",
      "SKIP: trivial or re-discoverable info, task progress, temporary TODO state, secrets.",
      "IF FULL: an add is rejected with the current entries — consolidate with one operations[] batch (remove/replace + add) in the same turn.",
      "A success message means the write is complete — do not repeat it.",
    ],
    parameters: Type.Object({
      target: Type.Optional(
        Type.Union([Type.Literal("project"), Type.Literal("user")], {
          description: "Store target: 'project' (default) or 'user'.",
        }),
      ),
      text: Type.Optional(
        Type.String({ description: "Short durable fact (one idea). Required unless operations is set." }),
      ),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags (single-add only)" })),
      importance: Type.Optional(Type.Number({ description: "0–1 importance, default 0.5 (single-add only)" })),
      operations: Type.Optional(
        Type.Array(
          Type.Object({
            action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")]),
            text: Type.Optional(Type.String({ description: "Fact text for add/replace." })),
            oldText: Type.Optional(
              Type.String({ description: "Unique substring of the entry to replace/remove." }),
            ),
          }),
          {
            description:
              "Atomic batch of add/replace/remove ops; all-or-nothing, budget checked on the final state. " +
              "When set, text/tags/importance are ignored.",
          },
        ),
      ),
    }),
    async execute(_id, args) {
      const settings = memorySettings();
      if (!settings.enabled) return disabledResult();
      const scope = pickScope(args.target);
      try {
        if (Array.isArray(args.operations)) {
          const ops: MemoryOperation[] = args.operations.map((raw) => {
            const rec = (raw ?? {}) as Record<string, unknown>;
            return {
              action: rec.action as MemoryOperation["action"],
              text: typeof rec.text === "string" ? rec.text : undefined,
              oldText: typeof rec.oldText === "string" ? rec.oldText : undefined,
            };
          });
          const result = applyMemoryOperations(cwd, ops, { scope, settings });
          return {
            content: [{ type: "text", text: writeSavedMessage(scope, result.facts, settings) }],
            details: result,
          };
        }
        const text = typeof args.text === "string" ? args.text : "";
        if (!text.trim()) {
          return {
            content: [{ type: "text", text: "text is required (or pass an operations array)." }],
            isError: true,
          };
        }
        const fact = retainMemoryFact(cwd, text, {
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          importance: typeof args.importance === "number" ? args.importance : 0.5,
          source: "tool",
          settings,
          scope,
        });
        return {
          content: [{ type: "text", text: writeSavedMessage(scope, listMemoryFacts(cwd, scope), settings) }],
          details: fact,
        };
      } catch (error) {
        // Budget-overflow / ambiguity errors carry the full guidance text
        // (entries + consolidation instruction) so the model can self-correct
        // in the same turn.
        return errorResult(error);
      }
    },
  };

  const recall: ToolDefinitionLike = {
    name: "memory_recall",
    label: "memory_recall",
    description:
      "Search durable memory facts by keyword. target: 'user' (who the user is), " +
      "'project' (environment/conventions/lessons), or 'both' (default). Results are labeled by scope.",
    promptSnippet: "Search user and project memory for relevant facts",
    parameters: Type.Object({
      query: Type.String({ description: "Keyword query" }),
      limit: Type.Optional(Type.Number({ description: "Max results per store (default 8)" })),
      target: Type.Optional(
        Type.Union([Type.Literal("project"), Type.Literal("user"), Type.Literal("both")], {
          description: "Which store(s) to search (default 'both').",
        }),
      ),
    }),
    async execute(_id, args) {
      const settings = memorySettings();
      if (!settings.enabled) return disabledResult();
      const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 8;
      const query = String(args.query ?? "");
      const target = args.target === "user" || args.target === "project" ? args.target : "both";
      const scopes: MemoryScope[] = target === "both" ? ["user", "project"] : [target];
      const hits: Array<{ scope: MemoryScope; fact: MemoryFact }> = [];
      for (const scope of scopes) {
        for (const fact of recallMemoryFacts(cwd, query, limit, scope)) {
          hits.push({ scope, fact });
        }
      }
      if (hits.length === 0) {
        return { content: [{ type: "text", text: "No matching memory facts." }] };
      }
      const lines = hits.map((h, i) => `${i + 1}. [${h.scope}] [${h.fact.id}] ${h.fact.text}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { facts: hits.map((h) => ({ scope: h.scope, ...h.fact })) },
      };
    },
  };

  const reflect: ToolDefinitionLike = {
    name: "memory_reflect",
    label: "memory_reflect",
    description:
      "Synthesize project memory into a mental-model summary (themes, pillars, conventions). " +
      "Uses a utility model when available; otherwise offline clustering. Optional focus query. " +
      "Project-scope only; user memory is not included.",
    promptSnippet: "Reflect on stored project memory",
    promptGuidelines: [
      "Use memory_reflect when you need a high-level project mental model, not a single keyword hit.",
      "Pass focus to steer the synthesis (e.g. 'git workflow' or 'auth').",
      "Do not store secrets; reflect only summarizes existing memory_retain facts.",
    ],
    parameters: Type.Object({
      focus: Type.Optional(Type.String({ description: "Optional focus query to weight relevant facts" })),
      limit: Type.Optional(Type.Number({ description: "Max facts to consider (default 40)" })),
      useModel: Type.Optional(Type.Boolean({ description: "Use utility model synthesis (default true)" })),
      retain: Type.Optional(Type.Boolean({ description: "Also store a short reflect summary fact (default false)" })),
      heuristicOnly: Type.Optional(Type.Boolean({ description: "Force offline heuristic (alias of useModel=false)" })),
    }),
    async execute(_id, args) {
      const settings = memorySettings();
      if (!settings.enabled) return disabledResult();
      try {
        const focus = typeof args.focus === "string" ? args.focus : undefined;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const heuristicOnly = args.heuristicOnly === true || args.useModel === false;
        const retain = args.retain === true;

        const reflection = heuristicOnly
          ? reflectMemoryHeuristic(cwd, { focus, limit })
          : await runMemoryReflect(cwd, { focus, limit, useModel: true, retain });

        return {
          content: [{ type: "text", text: reflection.summary }],
          details: {
            mode: reflection.mode,
            factCount: reflection.factCount,
            themes: reflection.themes,
            tagGroups: reflection.tagGroups,
            pillars: reflection.pillars,
            sourceFactIds: reflection.sourceFactIds,
            model: reflection.model,
          },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  // Keep list tool internal-ish via recall with empty query path; no extra tool needed.
  void deleteMemoryFact;
  void buildMemoryInjectBlock;

  return [retain, recall, reflect];
}
