"use client";

/**
 * Windowed conversation node list. Dispatches MessageView by ConversationNode.kind.
 */
import { useMemo, type ReactNode, type RefObject } from "react";
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "@/lib/types";
import { assembleTranscript, getFinalAssistantParts, type ConversationNode } from "@/lib/conversation-nodes";
import { getVisibleRenderWindow } from "@/lib/chat-lazy-load";
import { MessageView } from "../MessageView";
import {
  LIVE_TAIL_RENDER_ITEMS,
  getTurnToolCallCount,
} from "../chat-window/chat-window-helpers";
import { ProcessDetailsGroup } from "../chat-window/ProcessDetailsGroup";

export type TranscriptProps = {
  messages: AgentMessage[];
  entryIds: string[];
  streamState: { isStreaming: boolean; streamingMessage: Partial<AgentMessage> | null };
  promptRunId: number;
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
  promptRunId,
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

  const hasStream = streamState.isStreaming && streamState.streamingMessage != null;

  const planned = useMemo(() => {
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

    const nodes = assembleTranscript({
      messages,
      entryIds,
      // Truthiness only — stream tokens must not rebuild the historical tree.
      stream: hasStream ? { role: "assistant" } : null,
      promptRunId,
      busy: sessionBusy,
    });

    const { startIndex, hasMore } = getVisibleRenderWindow(nodes.length, visibleCount);

    const attachVisibleRef = (refIndex: number) => (el: HTMLDivElement | null) => {
      messageRefs.current[refIndex] = el;
    };

    const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; rowKey?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; liveTail?: boolean; variant?: "answer" | "process" } = {}): ReactNode => {
      const msg = options.messageOverride ?? messages[idx];
      const prevAssistantEntryId =
        msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
          ? entryIds[idx - 1]
          : undefined;
      const isVisible =
        msg.role === "user"
        || msg.role === "assistant"
        || msg.role === "custom"
        || msg.role === "bashExecution";
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
          key={options.rowKey ?? `${keyPrefix}-${idx}`}
          className={options.liveTail ? "chat-message-item is-live" : "chat-message-item"}
          ref={attachRef ? attachVisibleRef(currentRefIdx!) : undefined}
          data-entry-id={entryId || undefined}
        >
          {view}
        </div>
      );
    };

    const renderProcessGroup = (item: Extract<ConversationNode, { kind: "process" }>, liveTail = false): ReactNode => {
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
          key={item.id}
          className={liveTail ? "chat-message-item is-live" : "chat-message-item"}
          ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
        >
          {processGroup}
        </div>
      );
    };

    const liveTailStartIndex = Math.max(startIndex, nodes.length - LIVE_TAIL_RENDER_ITEMS);
    const rendered: ReactNode[] = [];
    for (let planIdx = startIndex; planIdx < nodes.length; planIdx++) {
      const item = nodes[planIdx];
      const liveTail = planIdx >= liveTailStartIndex;
      if (item.kind === "stream") continue;
      if (item.kind === "answer") {
        rendered.push(renderMessage(item.idx, { messageOverride: item.message, liveTail, rowKey: item.id }));
      } else if (item.kind === "process") {
        rendered.push(renderProcessGroup(item, liveTail));
      } else {
        rendered.push(renderMessage(item.idx, { liveTail, rowKey: item.id }));
      }
    }

    return {
      historyHasMore: hasMore,
      liveTailStartIndex,
      nodeCount: nodes.length,
      hasStreamNode: nodes[nodes.length - 1]?.kind === "stream",
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
    hasStream,
    promptRunId,
    visibleCount,
    messageRefs,
    stopScroll,
    pageEarlier,
  ]);

  const streamLiveTail = planned.hasStreamNode && planned.nodeCount - 1 >= planned.liveTailStartIndex;
  const streamEl = planned.hasStreamNode && streamState.streamingMessage
    ? (
      <div
        key={`stream:${promptRunId}`}
        className={streamLiveTail ? "chat-message-item is-streaming is-live" : "chat-message-item is-streaming"}
      >
        <MessageView
          message={streamState.streamingMessage as AgentMessage}
          isStreaming
          modelNames={modelNames}
          cwd={messageCwd}
          onOpenFile={onOpenFile}
        />
      </div>
    )
    : null;

  return {
    historyHasMore: planned.historyHasMore,
    historicalMessageNodes: (
      <>
        {planned.historicalMessageNodes}
        {streamEl}
      </>
    ),
  };
}
