/**
 * Project memory tools for Pi Web sessions.
 * Storage lives under ~/.pi/agent/project-memory/ (not in the user repo).
 */
import { Type } from "typebox";
import {
  buildMemoryInjectBlock,
  deleteMemoryFact,
  listMemoryFacts,
  parseProjectMemorySettings,
  recallMemoryFacts,
  reflectMemoryHeuristic,
  retainMemoryFact,
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

export function createProjectMemoryTools(cwd: string): ToolDefinitionLike[] {
  const retain: ToolDefinitionLike = {
    name: "memory_retain",
    label: "memory_retain",
    description:
      "Store a durable project fact for future sessions (conventions, commands, architecture notes). Never store secrets, tokens, passwords, or personal data.",
    promptSnippet: "Remember a durable project fact for later sessions",
    promptGuidelines: [
      "Use memory_retain for durable project conventions the next session should know.",
      "Never store secrets, API keys, passwords, or personal data in memory.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "Short durable fact (one idea)." }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags" })),
      importance: Type.Optional(Type.Number({ description: "0–1 importance, default 0.5" })),
    }),
    async execute(_id, args) {
      const settings = memorySettings();
      if (!settings.enabled) {
        return {
          content: [{ type: "text", text: "Project memory is disabled in Settings." }],
          isError: true,
        };
      }
      try {
        const fact = retainMemoryFact(cwd, String(args.text ?? ""), {
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          importance: typeof args.importance === "number" ? args.importance : 0.5,
          source: "tool",
          settings,
        });
        return {
          content: [{ type: "text", text: `Retained memory ${fact.id}: ${fact.text}` }],
          details: fact,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const recall: ToolDefinitionLike = {
    name: "memory_recall",
    label: "memory_recall",
    description: "Search durable project memory facts by keyword query.",
    promptSnippet: "Search project memory for relevant facts",
    parameters: Type.Object({
      query: Type.String({ description: "Keyword query" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 8)" })),
    }),
    async execute(_id, args) {
      const settings = memorySettings();
      if (!settings.enabled) {
        return {
          content: [{ type: "text", text: "Project memory is disabled in Settings." }],
          isError: true,
        };
      }
      const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 8;
      const facts = recallMemoryFacts(cwd, String(args.query ?? ""), limit);
      if (facts.length === 0) {
        return { content: [{ type: "text", text: "No matching project memory facts." }] };
      }
      const lines = facts.map((f, i) => `${i + 1}. [${f.id}] ${f.text}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { facts },
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
      if (!settings.enabled) {
        return {
          content: [{ type: "text", text: "Project memory is disabled in Settings." }],
          isError: true,
        };
      }
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
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  // Keep list tool internal-ish via recall with empty query path; no extra tool needed.
  void listMemoryFacts;
  void deleteMemoryFact;
  void buildMemoryInjectBlock;

  return [retain, recall, reflect];
}
