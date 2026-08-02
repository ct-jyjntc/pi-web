"use client";

import { useState } from "react";
import { Check, Copy, GitBranch, Undo2 } from "lucide-react";
import { Icon } from "../Icon";
import { MarkdownBody } from "../MarkdownBody";
import { PreviewableImage } from "../PreviewableImage";
import { copyText } from "@/lib/clipboard";
import { useLocale } from "@/hooks/useLocale";
import type { ImageContent, TextContent, UserMessage } from "@/lib/types";
import {
  USER_MSG_COLLAPSE_CHARS,
  USER_MSG_COLLAPSE_LINES,
  formatTime,
  imageSource,
} from "./message-view-utils";
import { MessageHoverShell } from "./MessageHoverShell";

export function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;
  const lineCount = content ? content.split("\n").length : 0;
  const isLong =
    content.length > USER_MSG_COLLAPSE_CHARS || lineCount > USER_MSG_COLLAPSE_LINES;
  const showCollapsed = isLong && !expanded;
  const collapsedPreview = content
    .split("\n")
    .slice(0, USER_MSG_COLLAPSE_LINES)
    .join("\n")
    .slice(0, USER_MSG_COLLAPSE_CHARS);

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
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
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(content); }}
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
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
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
          )}
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
        </div>

      </div>
    </MessageHoverShell>
  );
}


