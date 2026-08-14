/**
 * Assemble ConversationNode[] from a session message list. Pure; no SDK.
 */
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from "./types";
import {
  getAssistantErrorMessage,
  getDisplayableAssistantBlocks,
  isHiddenContextMessage,
  splitFinalAssistantBlocks,
} from "./message-display";

export type ConversationNode =
  | { kind: "user"; id: string; idx: number }
  | { kind: "message"; id: string; idx: number }
  | {
      kind: "process";
      id: string;
      userIdx: number;
      finalAssistantIdx: number;
      processIndices: number[];
      processCount: number;
      hasAnswer: boolean;
    }
  | { kind: "answer"; id: string; idx: number; message: AssistantMessage }
  | { kind: "compaction"; id: string; idx: number }
  | { kind: "custom"; id: string; idx: number }
  | { kind: "bash"; id: string; idx: number }
  | { kind: "stream"; id: string };

export type AssembleTranscriptInput = {
  messages: AgentMessage[];
  entryIds: string[];
  stream: Partial<AgentMessage> | null;
  promptRunId: number;
  busy: boolean;
};

type IndexedKind = "user" | "message" | "compaction" | "custom" | "bash";

const displayableBlocksCache = new WeakMap<AssistantMessage, AssistantContentBlock[]>();

export function getCachedDisplayableBlocks(message: AssistantMessage): AssistantContentBlock[] {
  let blocks = displayableBlocksCache.get(message);
  if (!blocks) {
    blocks = getDisplayableAssistantBlocks(message);
    displayableBlocksCache.set(message, blocks);
  }
  return blocks;
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

export function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getCachedDisplayableBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom" && !isHiddenContextMessage(message);
}

function rowKind(message: AgentMessage): IndexedKind {
  if (message.role === "user") return "user";
  if (message.role === "bashExecution") return "bash";
  if (message.role === "custom") {
    return message.customType === "compaction" ? "compaction" : "custom";
  }
  return "message";
}

function entryId(entryIds: string[], idx: number): string {
  const id = entryIds[idx];
  if (typeof id === "string" && id.length > 0) return `entry:${id}`;
  return `idx:${idx}`;
}

function indexedNode(kind: IndexedKind, idx: number, entryIds: string[]): ConversationNode {
  return { kind, id: entryId(entryIds, idx), idx };
}

export function assembleTranscript({
  messages,
  entryIds,
  stream,
  promptRunId,
  busy,
}: AssembleTranscriptInput): ConversationNode[] {
  const nodes: ConversationNode[] = [];
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  const emitStream = () => {
    if (stream) nodes.push({ kind: "stream", id: `stream:${promptRunId}` });
  };

  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    if (isHiddenContextMessage(msg)) {
      idx += 1;
      continue;
    }
    if (msg.role !== "user") {
      nodes.push(indexedNode(rowKind(msg), idx, entryIds));
      idx += 1;
      continue;
    }

    const userIdx = idx;
    let endIdx = userIdx + 1;
    while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

    const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
    // Last user turn while a run is open stays flat — do not emit answer/process.
    const isLiveTail = (busy || !!stream) && userIdx === lastUserIdx;
    if (finalAssistantIdx === -1 || isLiveTail) {
      nodes.push(indexedNode("user", userIdx, entryIds));
      for (let renderIdx = userIdx + 1; renderIdx < endIdx; renderIdx++) {
        if (isHiddenContextMessage(messages[renderIdx])) continue;
        nodes.push(indexedNode(rowKind(messages[renderIdx]), renderIdx, entryIds));
      }
      if (userIdx === lastUserIdx) emitStream();
      idx = endIdx;
      continue;
    }

    nodes.push(indexedNode("user", userIdx, entryIds));

    const processIndices: number[] = [];
    for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
      if (hasDisplayableProcessMessage(messages[processIdx])) processIndices.push(processIdx);
    }
    const finalSplit = getFinalAssistantParts(messages[finalAssistantIdx] as AssistantMessage);
    const finalAnswerMessage = finalSplit.answerMessage;
    const processCount = processIndices.length + (finalSplit.processMessage ? 1 : 0);
    if (processCount > 0) {
      nodes.push({
        kind: "process",
        id: `${entryId(entryIds, userIdx)}:process`,
        userIdx,
        finalAssistantIdx,
        processIndices,
        processCount,
        hasAnswer: finalAnswerMessage !== null,
      });
    }
    if (finalAnswerMessage) {
      nodes.push({
        kind: "answer",
        id: entryId(entryIds, finalAssistantIdx),
        idx: finalAssistantIdx,
        message: finalAnswerMessage,
      });
    }
    for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
      if (isHiddenContextMessage(messages[renderIdx])) continue;
      nodes.push(indexedNode(rowKind(messages[renderIdx]), renderIdx, entryIds));
    }
    if (userIdx === lastUserIdx) emitStream();
    idx = endIdx;
  }

  if (lastUserIdx === -1) emitStream();
  return nodes;
}
