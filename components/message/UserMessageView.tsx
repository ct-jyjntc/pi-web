"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, GitBranch, Undo2 } from "lucide-react";
import { Icon } from "../Icon";
import { MarkdownBody } from "../MarkdownBody";
import { PreviewableImage } from "../PreviewableImage";
import { copyText } from "@/lib/clipboard";
import { useLocale } from "@/hooks/useLocale";
import type { ImageContent, TextContent, UserMessage } from "@/lib/types";
import { skillExpansionToCommand } from "@/lib/slash-display";
import {
  USER_MSG_COLLAPSE_CHARS,
  USER_MSG_COLLAPSE_LINES,
  formatTime,
  imageSource,
} from "./message-view-utils";
import { MessageHoverShell } from "./MessageHoverShell";
import { EditFromHereDialog, type EditFromHereMode } from "./EditFromHereDialog";
import { apiFetch } from "@/lib/api-transport";

/** Replace the first text block (or string content) while keeping image blocks. */
export function replaceUserMessageText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };

  const content: Array<TextContent | ImageContent> = [];
  let replaced = false;
  for (const block of message.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (!replaced) {
      content.push({ ...block, text });
      replaced = true;
    }
  }
  if (!replaced) content.unshift({ type: "text", text });
  return { ...message, content };
}

export function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, sessionId }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (message: UserMessage) => void;
  sessionId?: string;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [skillExpanded, setSkillExpanded] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const contentBlocks = Array.isArray(message.content) ? message.content : [];
  const content =
    typeof message.content === "string"
      ? message.content
      : contentBlocks
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : contentBlocks.filter((b): b is ImageContent => b.type === "image");

  const commandText = skillExpansionToCommand(content);
  const commandSeparator = commandText?.search(/\s/) ?? -1;
  const commandName = commandText
    ? (commandSeparator === -1 ? commandText : commandText.slice(0, commandSeparator))
    : "";
  const commandArgs = commandText && commandSeparator !== -1
    ? commandText.slice(commandSeparator + 1)
    : "";

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;
  const copyTarget = commandText ?? content;
  const editTarget = commandText ? replaceUserMessageText(message, commandText) : message;
  const lineCount = content ? content.split("\n").length : 0;
  const isLong =
    !commandText && (content.length > USER_MSG_COLLAPSE_CHARS || lineCount > USER_MSG_COLLAPSE_LINES);
  const showCollapsed = isLong && !expanded;
  const collapsedPreview = content
    .split("\n")
    .slice(0, USER_MSG_COLLAPSE_LINES)
    .join("\n")
    .slice(0, USER_MSG_COLLAPSE_CHARS);

  const imageBlocksNode = imageBlocks.length > 0 && (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content || commandText ? 8 : 0 }}>
      {imageBlocks.map((img, i) => {
        const src = imageSource(img);
        if (!src) return null;
        return (
          <PreviewableImage
            key={i}
            src={src}
            alt=""
            className="chat-sent-image"
            previewLabel={t("msg.imagePreview")}
          />
        );
      })}
    </div>
  );

  const copyContent = () => {
    copyText(copyTarget).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const applyEditOnly = () => {
    if (!prevAssistantEntryId || !onNavigate) return;
    onNavigate(prevAssistantEntryId);
    onEditContent?.(editTarget);
  };

  const handleEditFromHereChoice = async (mode: EditFromHereMode) => {
    if (!prevAssistantEntryId || !onNavigate) return;
    setEditError(null);

    if (mode === "edit-only") {
      applyEditOnly();
      setEditDialogOpen(false);
      return;
    }

    // edit-and-revert: undo agent file turns from this leaf through newest, then branch + fill.
    if (!sessionId) {
      applyEditOnly();
      setEditDialogOpen(false);
      return;
    }

    setEditBusy(true);
    try {
      const res = await apiFetch("/api/workspace-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          action: "undo-through",
          leafId: prevAssistantEntryId,
        }),
      });
      const data = await res.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        undone?: number;
      } | null;
      // 409 with partial failure: surface error; do not navigate into a dirty state silently.
      if (!res.ok && data?.ok === false) {
        setEditError(data.error ?? t("msg.editFromHereRevertFailed"));
        return;
      }
      // ok with undone 0 is fine (no file turns) — still edit.
      applyEditOnly();
      setEditDialogOpen(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <>
      <MessageHoverShell
        style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
        renderActions={(active) => (
          // Bottom row: action buttons + timestamp
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            gap: 6, marginTop: 3,
          }}>
            <div style={{
              display: "flex", gap: 3,
              opacity: active ? 1 : 0,
              pointerEvents: active ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              <button
                onClick={copyContent}
                title={t("msg.copyMessage")}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", height: 22,
                  background: "none", border: "none",
                  borderRadius: "var(--radius-sm)",
                  color: copied ? "var(--accent)" : "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 11, fontWeight: 400,
                  whiteSpace: "nowrap",
                  transition: "color 0.12s",
                }}
                onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
              >
                {copied ? (
                  <Icon icon={Check} size={11} strokeWidth={1.8} />
                ) : (
                  <Icon icon={Copy} size={11} strokeWidth={1.8} />
                )}
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            {(canFork || canNavigate) && (
              <div style={{
                display: "flex", gap: 3,
                opacity: (active || forking) ? 1 : 0,
                pointerEvents: (active || forking) ? "auto" : "none",
                transition: "opacity 0.12s",
              }}>
                {canNavigate && (
                  <button
                    onClick={() => {
                      setEditError(null);
                      setEditDialogOpen(true);
                    }}
                    title={t("msg.editFromHereTitle")}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "3px 8px", height: 22,
                      background: "none", border: "none",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      fontSize: 11, fontWeight: 400,
                      whiteSpace: "nowrap",
                      transition: "color 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                  >
                    <Icon icon={Undo2} size={11} strokeWidth={1.8} />
                    {t("msg.editFromHere")}
                  </button>
                )}
                {canFork && (
                  <button
                    onClick={() => { onFork!(entryId!); }}
                    disabled={forking}
                    title={forking ? t("msg.creatingSession") : t("msg.newSessionTitle")}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "3px 8px", height: 22,
                      background: "none", border: "none",
                      borderRadius: "var(--radius-sm)",
                      color: forking ? "var(--accent)" : "var(--text-dim)",
                      cursor: forking ? "not-allowed" : "pointer",
                      fontSize: 11, fontWeight: 400,
                      whiteSpace: "nowrap",
                      transition: "color 0.12s",
                    }}
                    onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                    onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                  >
                    <Icon icon={GitBranch} size={11} strokeWidth={1.8} />
                    {forking ? t("msg.creating") : t("msg.newSession")}
                  </button>
                )}
              </div>
            )}
            {time && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{time}</span>}
          </div>
        )}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "85%" }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              background: "var(--user-bg)",
              border: "1px solid color-mix(in oklab, var(--border) 80%, transparent)",
              borderRadius: "var(--radius-lg)",
              padding: "8px 12px",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--text)",
              wordBreak: "break-word",
            }}
          >
            {commandText ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                {imageBlocksNode}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setSkillExpanded((prev) => !prev)}
                    title={skillExpanded ? t("msg.collapse") : t("msg.expand")}
                    aria-expanded={skillExpanded}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexShrink: 0,
                      padding: 0,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {commandName}
                    </span>
                    <Icon
                      icon={ChevronDown}
                      size={11}
                      strokeWidth={2}
                      style={{
                        flexShrink: 0,
                        opacity: 0.75,
                        transform: skillExpanded ? "rotate(180deg)" : "none",
                        transition: "transform 0.15s",
                      }}
                    />
                  </button>
                  {commandArgs && (
                    <span style={{
                      color: "var(--text)",
                      fontSize: 14,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      minWidth: 0,
                      flex: 1,
                    }}>
                      {commandArgs}
                    </span>
                  )}
                </div>
                {skillExpanded && (
                  <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>
                    {content}
                  </MarkdownBody>
                )}
              </div>
            ) : (
              <>
                {imageBlocksNode}
                {content && (
                  showCollapsed ? (
                    <div>
                      <div
                        style={{
                          maxHeight: 140,
                          overflow: "hidden",
                          position: "relative",
                          maskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
                          WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
                        }}
                      >
                        <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>
                          {collapsedPreview}
                        </MarkdownBody>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        style={{
                          marginTop: 6,
                          padding: "2px 0",
                          border: "none",
                          background: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {t("msg.showMore")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>{content}</MarkdownBody>
                      {isLong && (
                        <button
                          type="button"
                          onClick={() => setExpanded(false)}
                          style={{
                            marginTop: 6,
                            padding: "2px 0",
                            border: "none",
                            background: "none",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {t("msg.showLess")}
                        </button>
                      )}
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </div>
      </MessageHoverShell>
      {editDialogOpen && (
        <EditFromHereDialog
          busy={editBusy}
          error={editError}
          onCancel={() => {
            if (!editBusy) {
              setEditDialogOpen(false);
              setEditError(null);
            }
          }}
          onChoose={(mode) => { void handleEditFromHereChoice(mode); }}
        />
      )}
    </>
  );
}
