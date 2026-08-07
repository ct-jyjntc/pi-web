"use client";

/**
 * Role dispatcher for a single chat message. Block renderers live under ./blocks.
 */
import { memo } from "react";
import { isHiddenContextMessage } from "@/lib/message-display";
import type {
  AgentMessage,
  AssistantMessage,
  BashExecutionMessage,
  CustomMessage,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";
import { haveSameRelevantToolResults } from "./message-view-utils";
import { UserMessageView } from "./UserMessageView";
import { AssistantMessageView } from "./AssistantMessageView";
import { CustomMessageView } from "./CustomMessageView";
import { CompactionMessageView } from "./CompactionMessageView";
import { BashExecutionView } from "./BashExecutionView";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (message: UserMessage) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  /**
   * `process` = intermediate turn chrome (thinking/tools/narration). Quieter
   * scaffold styling, no model/usage chrome. Default is full answer surface.
   */
  variant?: "answer" | "process";
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, modelNames, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp, sessionId, variant }: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        message={message as UserMessage}
        cwd={cwd}
        onOpenFile={onOpenFile}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
        onNavigate={onNavigate}
        prevAssistantEntryId={prevAssistantEntryId}
        onEditContent={onEditContent}
        sessionId={sessionId}
      />
    );
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} cwd={cwd} onOpenFile={onOpenFile} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} sessionId={sessionId} entryId={entryId} variant={variant} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    // Hidden model-only context (memory recall, mode brief) never renders.
    if (isHiddenContextMessage(message)) return null;
    if ((message as CustomMessage).customType === "compaction") {
      return <CompactionMessageView message={message as CustomMessage} />;
    }
    return <CustomMessageView message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.entryId === next.entryId
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    && prev.onNavigate === next.onNavigate
    && prev.prevAssistantEntryId === next.prevAssistantEntryId
    && prev.onEditContent === next.onEditContent
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.sessionId === next.sessionId
    && prev.variant === next.variant;
});

