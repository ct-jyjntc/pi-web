/**
 * Tool card types and the only functions that run presenters on a message list.
 */
import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";
import { lookupPresenter } from "./tool-presenters/index";
import { isRecord } from "./type-guards";

export type ToolCardKind = "generic" | "terminal" | "diff" | "read" | "search" | "web" | "ask";
export type ScaffoldGroup = "command" | "explore" | "other";

export type ToolPresentation = {
  card: ToolCardKind;
  title: string;
  preview?: string;
  locations?: string[];
  hoist?: boolean;
  patch?: string;
  command?: string;
  query?: string;
};

export type ToolResultLike = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError?: boolean;
};

export type ToolPresenter = {
  presentCall(args: Record<string, unknown>): ToolPresentation;
  presentResult(args: Record<string, unknown>, result: ToolResultLike): ToolPresentation;
};

export function presenterFor(name: string): ToolPresenter {
  return lookupPresenter(name);
}

export function scaffoldGroupFromCard(card: ToolCardKind): ScaffoldGroup {
  if (card === "terminal") return "command";
  if (card === "read" || card === "search" || card === "web") return "explore";
  return "other";
}

export function patchFromToolDetails(details: unknown): string | null {
  if (!isRecord(details)) return null;
  if (typeof details.patch === "string" && details.patch) return details.patch;
  if (typeof details.diff === "string" && details.diff) return details.diff;
  // Nested hashline multi-result: concatenate per-file patches.
  const results = details.results;
  if (!Array.isArray(results)) return null;
  const parts: string[] = [];
  for (const row of results) {
    if (!isRecord(row)) continue;
    const p = typeof row.patch === "string" ? row.patch : typeof row.diff === "string" ? row.diff : null;
    if (p) parts.push(p);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function safePresent(
  name: string,
  run: () => ToolPresentation,
): ToolPresentation {
  try {
    return run();
  } catch {
    // One presenter must not fail the whole hydrate.
    console.warn(`[tool-presentation] presenter failed for ${name}`);
    return { card: "generic", title: name };
  }
}

export function attachPresentationToMessages(messages: AgentMessage[]): AgentMessage[] {
  const results = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    if (msg.toolCallId) results.set(msg.toolCallId, msg);
  }
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const assistant = msg as AssistantMessage;
    if (!Array.isArray(assistant.content)) return msg;
    return {
      ...assistant,
      content: assistant.content.map((block) => {
        if (block.type !== "toolCall") return block;
        const tc = block as ToolCallContent;
        const presenter = presenterFor(tc.toolName);
        const result = results.get(tc.toolCallId);
        const presentation = safePresent(tc.toolName, () => (
          result
            ? presenter.presentResult(tc.input ?? {}, result)
            : presenter.presentCall(tc.input ?? {})
        ));
        return { ...tc, presentation };
      }),
    };
  });
}

const GENERIC_FALLBACK_TITLES = new Set([
  "web", "search", "ask", "read", "write", "edit", "bash", "todo", "generic",
]);

function isMoreSpecificTitle(title: string | undefined, toolName: string): boolean {
  if (!title || title === toolName) return false;
  return !GENERIC_FALLBACK_TITLES.has(title);
}

function mergePresentation(
  existing: ToolPresentation | undefined,
  incoming: ToolPresentation,
  toolName: string,
): ToolPresentation {
  if (!existing) return incoming;
  // card / patch / hoist always come from the result presentation.
  const merged: ToolPresentation = { ...existing, ...incoming };
  if (!isMoreSpecificTitle(incoming.title, toolName) && existing.title) {
    merged.title = existing.title;
  }
  if (!incoming.preview && existing.preview !== undefined) merged.preview = existing.preview;
  if (!incoming.query && existing.query !== undefined) merged.query = existing.query;
  if (!incoming.command && existing.command !== undefined) merged.command = existing.command;
  if (!(incoming.locations && incoming.locations.length) && existing.locations !== undefined) {
    merged.locations = existing.locations;
  }
  return merged;
}

export function copyPresentationOntoToolCall(
  messages: AgentMessage[],
  toolCallId: string,
  presentation: ToolPresentation,
): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const assistant = msg as AssistantMessage;
    if (!Array.isArray(assistant.content)) return msg;
    let changed = false;
    const content = assistant.content.map((block) => {
      if (block.type !== "toolCall") return block;
      const tc = block as ToolCallContent;
      if (tc.toolCallId !== toolCallId) return block;
      changed = true;
      return { ...tc, presentation: mergePresentation(tc.presentation, presentation, tc.toolName) };
    });
    return changed ? { ...assistant, content } : msg;
  });
}
