/**
 * Pure transcript helpers for ChatWindow (render plan, process/answer split, scroll parent).
 */
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from "@/lib/types";
import {
  countToolCallBlocks,
  getAssistantErrorMessage,
  getDisplayableAssistantBlocks,
  isHiddenContextMessage,
  splitFinalAssistantBlocks,
} from "@/lib/message-display";
import type { AgentPhase } from "@/hooks/useAgentSession";
import type { MessageKey } from "@/lib/i18n/messages";

export function phaseLabel(phase: AgentPhase, t: (key: MessageKey, params?: Record<string, string | number>) => string, locale: string): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    const sep = locale === "zh" ? "、" : ", ";
    if (names.length === 0) return t("window.runningTool");
    if (names.length === 1) return t("window.runningNamed", { name: names[0] });
    if (names.length <= 3) return t("window.runningNamedMany", { names: names.join(sep) });
    return t("window.runningNamedMore", { names: names.slice(0, 2).join(sep), n: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("window.waitingModel");
  if (phase?.kind === "running_command") return t("window.runningCommand");
  return t("window.thinking");
}

/** Match app-topbar trailing icon column: 1px divider + 36px button = 37px total. */
export const CHAT_RAIL_BTN_WIDTH = 36;
export const CHAT_RAIL_WIDTH = CHAT_RAIL_BTN_WIDTH + 1; // + left divider
export const CHAT_COLUMN_PADDING = 16;
/** Cold open mounts only this many trailing render items synchronously; the
 * rest of the first page backfills on the next frame inside a transition. */
export const FIRST_PAINT_RENDER_ITEMS = 20;
/** Settle loop: hand scroll back once scrollHeight holds steady this many rAFs. */
export const SCROLL_SETTLE_STABLE_FRAMES = 2;
/** Settle loop hard cap (~250ms at 60fps) so late async loads can't pin it. */
export const SCROLL_SETTLE_MAX_FRAMES = 15;
/** Newest render items exempt from content-visibility — they can still grow
 * (streaming, pending media, KaTeX/mermaid late loads) and a stale remembered
 * height would drift the scroll lock. */
export const LIVE_TAIL_RENDER_ITEMS = 6;

export function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  const assistant = message as AssistantMessage;
  if (getAssistantErrorMessage(assistant)) return true;
  return getFinalAssistantParts(assistant).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

export function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

export function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  if (!Array.isArray(message.content)) return null;
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

// `getDisplayableAssistantBlocks` allocates a fresh filtered array per call and
// the transcript asks the same questions about the same messages on every
// render. Cache per message object — messages are immutable once appended
// (same contract `finalAssistantPartsCache` below relies on).
const displayableBlocksCache = new WeakMap<AssistantMessage, AssistantContentBlock[]>();

export function getCachedDisplayableBlocks(message: AssistantMessage): AssistantContentBlock[] {
  let blocks = displayableBlocksCache.get(message);
  if (!blocks) {
    blocks = getDisplayableAssistantBlocks(message);
    displayableBlocksCache.set(message, blocks);
  }
  return blocks;
}

export function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getCachedDisplayableBlocks(msg as AssistantMessage));
  }
  return count;
}

// Keyed by the turn's final assistant message: that message identifies the turn
// and changes whenever the turn grows another assistant reply.
const turnToolCallCountCache = new WeakMap<AssistantMessage, number>();

export function getTurnToolCallCount(
  messages: AgentMessage[],
  processIndices: number[],
  finalAssistant: AssistantMessage,
  finalProcessBlocks: AssistantContentBlock[],
): number {
  const cached = turnToolCallCountCache.get(finalAssistant);
  if (cached !== undefined) return cached;
  const count = countToolCalls(messages, processIndices) + countToolCallBlocks(finalProcessBlocks);
  turnToolCallCountCache.set(finalAssistant, count);
  return count;
}

export function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getCachedDisplayableBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom" && !isHiddenContextMessage(message);
}

export function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

// Derived process/answer messages must keep a stable identity across renders,
// otherwise MessageView's memo (which compares `message` by reference) is
// defeated and every completed turn re-renders on each streaming token.
export interface FinalAssistantParts {
  processBlocks: AssistantContentBlock[];
  answerBlocks: AssistantContentBlock[];
  processMessage: AssistantMessage | null;
  answerMessage: AssistantMessage | null;
}

const finalAssistantPartsCache = new WeakMap<AssistantMessage, FinalAssistantParts>();

export function getFinalAssistantParts(message: AssistantMessage): FinalAssistantParts {
  let parts = finalAssistantPartsCache.get(message);
  if (!parts) {
    const split = splitFinalAssistantBlocks(message);
    parts = {
      processBlocks: split.processBlocks,
      answerBlocks: split.answerBlocks,
      processMessage: split.processBlocks.length > 0
        ? withAssistantBlocks(message, split.processBlocks, { omitUsage: true })
        : null,
      answerMessage: split.answerBlocks.length > 0 || getAssistantErrorMessage(message)
        ? withAssistantBlocks(message, split.answerBlocks)
        : null,
    };
    finalAssistantPartsCache.set(message, parts);
  }
  return parts;
}

/**
 * One top-level transcript item, described without building React elements.
 * The plan is built for every message (cheap: role scan + WeakMap-cached block
 * lookups) so the render window can be sliced with the exact same semantics as
 * before, while element creation stays limited to the visible slice.
 */
export type RenderPlanItem =
  | { kind: "message"; idx: number }
  | { kind: "answer"; idx: number; message: AssistantMessage }
  | {
    kind: "process";
    userIdx: number;
    finalAssistantIdx: number;
    /** Already filtered to messages that actually render something. */
    processIndices: number[];
    processCount: number;
    hasAnswer: boolean;
  };

/** Nearest vertically scrollable ancestor (chat transcript scroller). */
export function findVerticalScrollParent(start: HTMLElement | null): HTMLElement | null {
  let el = start?.parentElement ?? null;
  while (el) {
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay")
      && el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}
