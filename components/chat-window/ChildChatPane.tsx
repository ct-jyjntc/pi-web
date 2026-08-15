/**
 * Child subagent transcript in the main chat column (not a dialog).
 * Follow-up / interrupt go through the parent host registry.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { apiFetch } from "@/lib/api-transport";
import { sendAgentCommand } from "@/lib/agent-client";
import { useLocale } from "@/hooks/useLocale";
import { isHiddenContextMessage } from "@/lib/message-display";
import type { AgentMessage, SessionContext, ToolResultMessage } from "@/lib/types";
import { useChildTranscript } from "@/lib/child-transcript-store";
import { CHAT_COLUMN_PADDING } from "./chat-window-helpers";
import { MessageView } from "../MessageView";
import { Icon } from "../Icon";

export function ChildChatPane({
  cwd,
  onOpenFile,
}: {
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useLocale();
  const request = useChildTranscript();
  const [context, setContext] = useState<SessionContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const loadContext = async (childSessionId: string, parentSessionId: string) => {
    const params = new URLSearchParams({
      parent: parentSessionId,
      deferThinking: "1",
      deferMedia: "1",
    });
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(childSessionId)}?${params}`);
    const data = await res.json() as { context?: SessionContext; error?: string };
    if (!res.ok || !data.context) {
      throw new Error(data.error || t("ext.childTranscriptMissing"));
    }
    setContext(data.context);
  };

  useEffect(() => {
    if (!request) {
      setContext(null);
      setError(null);
      setLoading(false);
      setDraft("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContext(null);
    void loadContext(request.childSessionId, request.parentSessionId)
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("ext.childTranscriptMissing"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request?.childSessionId, request?.parentSessionId, t]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const message of context?.messages ?? []) {
      if (message.role === "toolResult") map.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
    }
    return map;
  }, [context]);

  if (!request) return null;

  const messages = context?.messages ?? [];
  const entryIds = context?.entryIds ?? [];
  const visible = messages
    .map((message, index) => ({ message, entryId: entryIds[index], index }))
    .filter(({ message }) => message.role !== "toolResult" && !isHiddenContextMessage(message));

  const sendFollowup = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await sendAgentCommand(request.parentSessionId, {
        type: "subagent_followup",
        childSessionId: request.childSessionId,
        message: text,
      });
      setDraft("");
      await loadContext(request.childSessionId, request.parentSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ext.childTranscriptMissing"));
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sendAgentCommand(request.parentSessionId, {
        type: "subagent_interrupt",
        childSessionId: request.childSessionId,
      });
      await loadContext(request.childSessionId, request.parentSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ext.childTranscriptMissing"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="chat-scroll-clip h-full min-w-0 overflow-hidden" style={{ position: "relative", zIndex: 0 }}>
        <div
          className="chat-scroll-area h-full overflow-y-auto pt-4"
          style={{ paddingBottom: 140 }}
        >
          <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              {loading ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("ext.childTranscriptLoad")}</div>
              ) : error ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{error}</div>
              ) : visible.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("ext.childTranscriptEmpty")}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {visible.map(({ message, entryId, index }) => (
                    <MessageView
                      key={entryId ?? `${request.childSessionId}-${index}`}
                      message={message as AgentMessage}
                      toolResults={toolResults}
                      entryId={entryId}
                      sessionId={request.childSessionId}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="chat-composer-float">
        <div className="chat-composer-float-underlay" aria-hidden />
        <div className="chat-composer-float-body">
          <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <div className="composer-shell">
                <div className="composer-input-row">
                  <textarea
                    value={draft}
                    disabled={busy}
                    placeholder={t("ext.childFollowup")}
                    rows={1}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendFollowup();
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
                  {busy ? (
                    <button
                      type="button"
                      className="chrome-btn is-danger is-active"
                      onClick={() => void interrupt()}
                      title={t("ext.childInterrupt")}
                    >
                      <Icon icon={Square} size={10} fill="currentColor" strokeWidth={0} />
                      {t("ext.childInterrupt")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="composer-send"
                      disabled={!draft.trim()}
                      onClick={() => void sendFollowup()}
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
  );
}
