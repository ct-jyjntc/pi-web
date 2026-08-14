/**
 * Pure transcript helpers for ChatWindow (render plan, scroll parent).
 * Process/answer split lives in lib/conversation-nodes.ts.
 */
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from "@/lib/types";
import { countToolCallBlocks } from "@/lib/message-display";
import { getCachedDisplayableBlocks } from "@/lib/conversation-nodes";
import type { AgentPhase } from "@/hooks/useAgentSession";
import type { MessageKey } from "@/lib/i18n/messages";

export {
  hasFinalAssistantAnswer,
  findFinalAssistantIndex,
  getFinalAssistantParts,
  hasDisplayableProcessMessage,
} from "@/lib/conversation-nodes";

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

/**
 * Forward vertical wheel from chrome outside the scroll owner (right rail /
 * minimap) into `.chat-scroll-area`. Single owner: only mutates that element's
 * scrollTop — no second scroller.
 */
export function forwardWheelToScrollContainer(
  el: HTMLElement | null | undefined,
  deltaY: number,
  deltaMode = 0,
): void {
  if (!el || deltaY === 0) return;
  // WheelEvent.deltaMode: 0=pixel, 1=line, 2=page. Manual scrollTop needs the same scaling the browser applies for overflow:auto.
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? el.clientHeight : 1;
  el.scrollTop += deltaY * scale;
}
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
