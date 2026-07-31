/**
 * Project memory tools for Pi Web sessions.
 * Storage lives under ~/.pi/agent/project-memory/ (not in the user repo).
 * Global/user-scope memory is intentionally not exposed.
 */
import { Type } from "typebox";
import {
  applyMemoryOperations,
  getProjectMemorySettings,
  listMemoryFacts,
  memoryBudgetChars,
  memoryStoreUsage,
  recallMemoryFacts,
  retainMemoryFact,
  type MemoryFact,
  type MemoryOperation,
  type ProjectMemorySettings,
} from "./project-memory";
import { runMemoryReflect } from "./memory-reflect";

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
  return getProjectMemorySettings();
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

/** Terminal success message — confirms the write landed and tells the model to stop. */
function writeSavedMessage(
  facts: MemoryFact[],
  settings: ProjectMemorySettings,
): string {
  const used = memoryStoreUsage(facts);
  const budget = memoryBudgetChars(settings);
  return (
    `Write saved (project memory, ${facts.length} facts, ${used}/${budget} chars). ` +
    "This update is complete — do not repeat it."
  );
}

export function createProjectMemoryTools(cwd: string): ToolDefinitionLike[] {
  const retain: ToolDefinitionLike = {
    name: "memory_retain",
    label: "memory_retain",
    description:
      "Save durable project memory for future sessions in this repo (environment, conventions, " +
      "tool quirks, lessons). WHEN: you learn a stable fact about the project setup. " +
      "SKIP: trivial or easily re-discovered info, task progress, temporary TODOs, raw dumps, secrets, " +
      "and personal user preferences (not stored). " +
      "Pass operations[] for an atomic add/replace/remove batch (entries addressed by unique " +
      "substring via oldText); the char budget is checked on the final state only. " +
      "IF FULL: the write is rejected with all current entries — reissue ONE call with " +
      "operations[] that removes/shortens stale entries AND adds the new one together.",
    promptSnippet: "Save a durable project memory (success is terminal — do not repeat)",
    promptGuidelines: [
      "WHEN to save: stable environment/convention/project facts only.",
      "Project-scope only — do not store personal user preferences here.",
      "SKIP: trivial or re-discoverable info, task progress, temporary TODO state, secrets.",
      "IF FULL: an add is rejected with the current entries — consolidate with one operations[] batch (remove/replace + add) in the same turn.",
      "A success message means the write is complete — do not repeat it.",
    ],
    parameters: Type.Object({
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
          const result = applyMemoryOperations(cwd, ops, { settings });
          return {
            content: [{ type: "text", text: writeSavedMessage(result.facts, settings) }],
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
        });
        return {
          content: [{ type: "text", text: writeSavedMessage(listMemoryFacts(cwd), settings) }],
          details: fact,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  const recall: ToolDefinitionLike = {
    name: "memory_recall",
    label: "memory_recall",
    description:
      "Search durable project memory facts by keyword (environment, conventions, lessons).",
    promptSnippet: "Search project memory for relevant facts",
    parameters: Type.Object({
      query: Type.String({ description: "Keyword query" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 8)" })),
    }),
    async execute(_id, args) {
      const settings = memorySettings();
      if (!settings.enabled) return disabledResult();
      const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 8;
      const query = String(args.query ?? "");
      const hits = recallMemoryFacts(cwd, query, limit);
      if (hits.length === 0) {
        return { content: [{ type: "text", text: "No matching project memory facts." }] };
      }
      const lines = hits.map((fact, i) => `${i + 1}. [${fact.id}] ${fact.text}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { facts: hits },
      };
    },
  };

  const reflect: ToolDefinitionLike = {
    name: "memory_reflect",
    label: "memory_reflect",
    description:
      "Synthesize project memory into a mental-model summary (themes, pillars, conventions). " +
      "Uses a utility model when available; otherwise offline clustering. Optional focus query.",
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
        const result = await runMemoryReflect(cwd, {
          focus: typeof args.focus === "string" ? args.focus : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          useModel: args.heuristicOnly === true
            ? false
            : typeof args.useModel === "boolean"
              ? args.useModel
              : true,
          retain: args.retain === true,
        });
        return {
          content: [{ type: "text", text: result.summary }],
          details: result,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  return [retain, recall, reflect];
}
