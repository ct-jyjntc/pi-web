/**
 * Child subagent transcript in the main chat column, streamed like the parent.
 * Follow-up / interrupt go through the parent host registry.
 */
"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Square } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/hooks/useLocale";
import { useChildAgentStream } from "@/hooks/useChildAgentStream";
import { useChildTranscript } from "@/lib/child-transcript-store";
import {
  CHAT_COLUMN_PADDING,
  CHAT_RAIL_BTN_WIDTH,
  CHAT_RAIL_WIDTH,
  forwardWheelToScrollContainer,
} from "./chat-window-helpers";
import { ChatScrollRail } from "./ChatScrollRail";
import { useTranscriptNodes } from "../conversation/Transcript";
import { Icon } from "../Icon";

export function ChildChatPane({
  cwd,
  onOpenFile,
}: {
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const request = useChildTranscript();
  const [draft, setDraft] = useState("");
  const sendingRef = useRef(false);
  const stream = useChildAgentStream(request);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { historicalMessageNodes } = useTranscriptNodes({
    messages: stream.messages,
    entryIds: stream.entryIds,
    streamState: stream.streamState,
    promptRunId: 1,
    sessionBusy: stream.running,
    isNew: false,
    visibleCount: Number.POSITIVE_INFINITY,
    modelNames: {},
    messageCwd: cwd,
    sessionId: request?.childSessionId,
    forkingEntryId: null,
    onOpenFile,
    stopScroll: stream.stopScroll,
    pageEarlier: () => undefined,
    messageRefs,
  });

  if (!request) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text || sendingRef.current || stream.running) return;
    sendingRef.current = true;
    setDraft("");
    try {
      await stream.send(text);
    } catch (err) {
      setDraft(text);
      console.error(err);
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ isolation: "isolate" }}>
        <div className="chat-scroll-clip h-full min-w-0 overflow-hidden" style={{ position: "relative", zIndex: 0 }}>
          <div
            ref={stream.bindScrollContainer}
            className="chat-scroll-area h-full overflow-y-auto pt-4"
            style={{ paddingBottom: 140 }}
          >
            <div ref={stream.chatContentRef} style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
              <div style={{ maxWidth: 820, margin: "0 auto" }}>
                {stream.loading ? (
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("ext.childTranscriptLoad")}</div>
                ) : stream.error ? (
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{stream.error}</div>
                ) : stream.messages.length === 0 && !stream.streamState.isStreaming ? (
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("ext.childTranscriptEmpty")}</div>
                ) : (
                  historicalMessageNodes
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="chat-composer-float">
          <div className="chat-composer-float-underlay" aria-hidden />
          <div className="chat-composer-float-body">
            <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px 8px` }}>
              <div style={{ maxWidth: 820, margin: "0 auto" }}>
                <div className={`composer-shell${stream.running ? " is-streaming" : ""}`}>
                  <div className="composer-input-row">
                    <textarea
                      value={draft}
                      disabled={stream.running}
                      placeholder={t("ext.childFollowup")}
                      rows={1}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: "none",
                        outline: "none",
                        resize: "none",
                        background: "transparent",
                        color: "var(--text)",
                      }}
                    />
                  </div>
                  <div className="composer-toolbar">
                    <div style={{ flex: 1 }} />
                    {stream.running ? (
                      <button
                        type="button"
                        className="composer-send is-stop"
                        onClick={() => void stream.abort()}
                        title={t("ext.childInterrupt")}
                        aria-label={t("ext.childInterrupt")}
                      >
                        <Icon icon={Square} size={10} fill="currentColor" strokeWidth={0} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="composer-send"
                        disabled={!draft.trim()}
                        onClick={() => void send()}
                        title={t("ext.childSend")}
                        aria-label={t("ext.childSend")}
                      >
                        <Icon icon={ArrowUp} size={16} strokeWidth={2.2} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {isMobile ? null : (
        <div
          className="chat-scroll-rail"
          onWheel={(event) => {
            if (event.deltaY === 0) return;
            forwardWheelToScrollContainer(stream.scrollContainerRef.current, event.deltaY, event.deltaMode);
          }}
          style={{
            width: CHAT_RAIL_WIDTH,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row",
            alignSelf: "stretch",
            background: "var(--bg-panel)",
            minHeight: 0,
          }}
        >
          <div className="chrome-divider" aria-hidden style={{ alignSelf: "stretch" }} />
          <div
            style={{
              width: CHAT_RAIL_BTN_WIDTH,
              minWidth: CHAT_RAIL_BTN_WIDTH,
              flex: "0 0 auto",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <ChatScrollRail scrollContainer={stream.scrollContainerRef} />
            <button
              type="button"
              className={`chrome-btn is-icon${stream.stickToBottom ? " is-active" : ""}`}
              onClick={stream.resumeStickToBottom}
              title={t("window.scrollToBottom")}
              aria-label={t("window.scrollToBottom")}
              aria-pressed={stream.stickToBottom}
              style={{
                width: CHAT_RAIL_BTN_WIDTH,
                minWidth: CHAT_RAIL_BTN_WIDTH,
                height: 36,
                minHeight: 36,
                borderTop: "1px solid var(--border)",
                borderRadius: 0,
                color: stream.stickToBottom ? "var(--text-dim)" : "var(--text-muted)",
              }}
            >
              <Icon icon={ArrowDown} size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
