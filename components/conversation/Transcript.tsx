"use client";

/**
 * Windowed historical transcript list. Owns RenderPlanItem construction and MessageView dispatch.
 */
import { useMemo, type ReactNode, type RefObject } from "react";
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "@/lib/types";
import { isHiddenContextMessage } from "@/lib/message-display";
import { getVisibleRenderWindow } from "@/lib/chat-lazy-load";
import { MessageView } from "../MessageView";
import {
  LIVE_TAIL_RENDER_ITEMS,
  findFinalAssistantIndex,
  getFinalAssistantParts,
  getTurnToolCallCount,
  hasDisplayableProcessMessage,
  type RenderPlanItem,
} from "../chat-window/chat-window-helpers";
import { ProcessDetailsGroup } from "../chat-window/ProcessDetailsGroup";

export type TranscriptProps = {
  messages: AgentMessage[];
  entryIds: string[];
  streamState: { isStreaming: boolean; streamingMessage: Partial<AgentMessage> | null };
  sessionBusy: boolean;
  isNew: boolean;
  visibleCount: number;
  modelNames: Record<string, string>;
  messageCwd?: string;
  sessionId?: string;
  forkingEntryId: string | null;
  onOpenFile?: (filePath: string) => void;
  onFork?: (entryId: string) => void;
  onNavigate?: (entryId: string) => void;
  onEditContent?: (message: UserMessage) => void;
  stopScroll: () => void;
  pageEarlier: () => void;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
};

export function useTranscriptNodes({
  messages,
  entryIds,
  streamState,
  sessionBusy,
  isNew,
  visibleCount,
  modelNames,
  messageCwd,
  sessionId,
  forkingEntryId,
  onOpenFile,
  onFork,
  onNavigate,
  onEditContent,
  stopScroll,
  pageEarlier,
  messageRefs,
}: TranscriptProps): {
  historicalMessageNodes: ReactNode;
  historyHasMore: boolean;
} {
  // Stable across streaming tokens (stream lives in streamState, not messages).
  // Avoids re-running process/answer grouping on every SSE tick.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);

  return useMemo(() => {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }

    const visibleRefIndexByMessage = new Map<number, number>();
    let refIdx = 0;
    messages.forEach((msg, idx) => {
      if (msg.role === "user" || msg.role === "assistant") {
        visibleRefIndexByMessage.set(idx, refIdx++);
      }
    });

    // Pass 1 — plan every render item. ChatMinimap walks the full message list
    // and keeps its own running ref index, so `visibleRefIndexByMessage` above
    // must stay global; only element creation below is windowed.
    const plan: RenderPlanItem[] = [];
    for (let idx = 0; idx < messages.length;) {
      const msg = messages[idx];
      // Hidden model-only context messages never get a render item.
      if (isHiddenContextMessage(msg)) {
        idx += 1;
        continue;
      }
      if (msg.role !== "user") {
        plan.push({ kind: "message", idx });
        idx += 1;
        continue;
      }

      const userIdx = idx;
      let endIdx = userIdx + 1;
      while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

      const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
      // Turns with no assistant answer, and the still-running tail, stay flat:
      // one item per message, no process grouping.
      const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastUserIdx;
      if (finalAssistantIdx === -1 || isLiveTail) {
        for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
          if (renderIdx !== userIdx && isHiddenContextMessage(messages[renderIdx])) continue;
          plan.push({ kind: "message", idx: renderIdx });
        }
        idx = endIdx;
        continue;
      }

      plan.push({ kind: "message", idx: userIdx });

      const processIndices: number[] = [];
      for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
        if (hasDisplayableProcessMessage(messages[processIdx])) processIndices.push(processIdx);
      }
      const finalSplit = getFinalAssistantParts(messages[finalAssistantIdx] as AssistantMessage);
      const finalAnswerMessage = finalSplit.answerMessage;

      const processCount = processIndices.length + (finalSplit.processMessage ? 1 : 0);
      if (processCount > 0) {
        plan.push({
          kind: "process",
          userIdx,
          finalAssistantIdx,
          processIndices,
          processCount,
          hasAnswer: finalAnswerMessage !== null,
        });
      }

      if (finalAnswerMessage) {
        plan.push({ kind: "answer", idx: finalAssistantIdx, message: finalAnswerMessage });
      }
      for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
        if (isHiddenContextMessage(messages[renderIdx])) continue;
        plan.push({ kind: "message", idx: renderIdx });
      }
      idx = endIdx;
    }

    // Same window arithmetic as before — `visibleCount` counts render items,
    // not messages and not turns — but applied before elements exist.
    const { startIndex, hasMore } = getVisibleRenderWindow(plan.length, visibleCount);

    const attachVisibleRef = (refIndex: number) => (el: HTMLDivElement | null) => {
      messageRefs.current[refIndex] = el;
    };

    const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; liveTail?: boolean; variant?: "answer" | "process" } = {}): ReactNode => {
      const msg = options.messageOverride ?? messages[idx];
      const prevAssistantEntryId =
        msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
          ? entryIds[idx - 1]
          : undefined;
      const isVisible = msg.role === "user" || msg.role === "assistant";
      const currentRefIdx = visibleRefIndexByMessage.get(idx);
      const keyPrefix = options.keyPrefix ?? "message";
      let showTimestamp = false;
      if (msg.role === "assistant") {
        showTimestamp = true;
        for (let j = idx + 1; j < messages.length; j++) {
          const r = messages[j].role;
          if (r === "user") break;
          if (r === "assistant") { showTimestamp = false; break; }
        }
        // Streaming bubble owns the live timestamp for the unfinished tail.
        if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
          showTimestamp = false;
        }
      }
      if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
      // Live multi-step turns stay flat, but intermediate assistants (already
      // finished, more of the turn still coming) should read as process rail —
      // not full answer chrome — so they don't flash as the final reply.
      let variant = options.variant;
      if (
        variant === undefined
        && msg.role === "assistant"
        && (sessionBusy || streamState.isStreaming)
        && idx > lastUserIdx
        && idx < messages.length - 1
      ) {
        const parts = getFinalAssistantParts(msg as AssistantMessage);
        if (parts.processBlocks.length > 0 && parts.answerBlocks.length === 0) {
          variant = "process";
        } else if (parts.processBlocks.length > 0) {
          // Has tools/thinking plus trailing text, but isn't the turn's final
          // answer yet — keep the whole bubble in process style until settle.
          variant = "process";
        }
      }
      const view = (
        <MessageView
          key={`${keyPrefix}-view-${idx}`}
          message={msg}
          toolResults={toolResultsMap}
          modelNames={modelNames}
          cwd={messageCwd}
          onOpenFile={onOpenFile}
          entryId={entryIds[idx]}
          onFork={sessionBusy || isNew || (idx === 0 && msg.role === "user") ? undefined : onFork}
          forking={forkingEntryId === entryIds[idx]}
          onNavigate={sessionBusy ? undefined : onNavigate}
          prevAssistantEntryId={sessionBusy ? undefined : prevAssistantEntryId}
          onEditContent={onEditContent}
          showTimestamp={showTimestamp}
          prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
          sessionId={sessionId}
          variant={variant}
        />
      );
      if (!isVisible) return null;
      const entryId = entryIds[idx];
      // Always mount a data-entry-id host so search can jump to process-rail
      // messages (attachRef false) as well as normal transcript rows.
      const attachRef = options.attachRef !== false && currentRefIdx !== undefined;
      return (
        <div
          key={`${keyPrefix}-${idx}`}
          className={options.liveTail ? "chat-message-item is-live" : "chat-message-item"}
          ref={attachRef ? attachVisibleRef(currentRefIdx!) : undefined}
          data-entry-id={entryId || undefined}
        >
          {view}
        </div>
      );
    };

    const renderProcessGroup = (item: Extract<RenderPlanItem, { kind: "process" }>, liveTail = false): ReactNode => {
      const finalAssistant = messages[item.finalAssistantIdx] as AssistantMessage;
      const finalSplit = getFinalAssistantParts(finalAssistant);
      const processRefIdx = item.processIndices
        .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
        .find((value): value is number => typeof value === "number")
        ?? (item.hasAnswer ? undefined : visibleRefIndexByMessage.get(item.finalAssistantIdx));
      const userTs = (messages[item.userIdx] as AgentMessage & { timestamp?: number }).timestamp;
      const finalTs = finalAssistant.timestamp;
      const durationSeconds =
        userTs && finalTs && finalTs >= userTs
          ? Math.round((finalTs - userTs) / 1000)
          : undefined;
      const processGroup = (
        <ProcessDetailsGroup
          durationSeconds={durationSeconds}
          toolCallCount={getTurnToolCallCount(messages, item.processIndices, finalAssistant, finalSplit.processBlocks)}
          onEscapeStickToBottom={stopScroll}
        >
          {item.processIndices.map((processIdx) => renderMessage(processIdx, { attachRef: false, keyPrefix: "process", variant: "process" }))}
          {finalSplit.processMessage && renderMessage(item.finalAssistantIdx, { attachRef: false, keyPrefix: "process-final", messageOverride: finalSplit.processMessage, showTimestamp: false, variant: "process" })}
        </ProcessDetailsGroup>
      );
      return (
        <div
          key={`process-group-${item.userIdx}-${item.finalAssistantIdx}`}
          className={liveTail ? "chat-message-item is-live" : "chat-message-item"}
          ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
        >
          {processGroup}
        </div>
      );
    };

    // Pass 2 — build elements for the visible window only. The newest few
    // render items (the live tail) stay fully laid out: content-visibility
    // only remembers a row's size AFTER it renders, so virtualizing a row
    // that can still grow snaps it to a stale height when skipped and drifts
    // the scroll lock. Older rows keep the .chat-message-item virtualization.
    const liveTailStartIndex = Math.max(startIndex, plan.length - LIVE_TAIL_RENDER_ITEMS);
    const rendered: ReactNode[] = [];
    for (let planIdx = startIndex; planIdx < plan.length; planIdx++) {
      const item = plan[planIdx];
      const liveTail = planIdx >= liveTailStartIndex;
      if (item.kind === "message") rendered.push(renderMessage(item.idx, { liveTail }));
      else if (item.kind === "answer") rendered.push(renderMessage(item.idx, { messageOverride: item.message, liveTail }));
      else rendered.push(renderProcessGroup(item, liveTail));
    }

    return {
      historyHasMore: hasMore,
      historicalMessageNodes: (
      <>
        {hasMore && (
          <button
            type="button"
            className="block w-full py-3 text-center text-xs text-text-muted"
            onClick={pageEarlier}
          >
            Scroll up to load earlier messages ({startIndex} hidden)
          </button>
        )}
        {rendered}
      </>
      ),
    };
  }, [
    messages,
    entryIds,
    toolResultsMap,
    modelNames,
    messageCwd,
    onOpenFile,
    sessionBusy,
    isNew,
    onFork,
    forkingEntryId,
    onNavigate,
    onEditContent,
    sessionId,
    streamState.isStreaming,
    visibleCount,
    messageRefs,
    stopScroll,
    pageEarlier,
  ]);
}
