/**
 * Child subagent transcript overlay with optional follow-up / interrupt.
 * Does not start a second AgentSession on the child file.
 */
"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-transport";
import { sendAgentCommand } from "@/lib/agent-client";
import { useLocale } from "@/hooks/useLocale";
import { isHiddenContextMessage } from "@/lib/message-display";
import type { AgentMessage, SessionContext, ToolResultMessage } from "@/lib/types";
import {
  closeChildTranscript,
  getChildTranscript,
  subscribeChildTranscript,
} from "@/lib/child-transcript-store";
import { CenteredDialog } from "../CenteredDialog";
import { MessageView } from "../MessageView";

export function ChildTranscriptDialog() {
  const { t } = useLocale();
  const request = useSyncExternalStore(subscribeChildTranscript, getChildTranscript, getChildTranscript);
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
    const params = new URLSearchParams({
      parent: request.parentSessionId,
      deferThinking: "1",
      deferMedia: "1",
    });
    void apiFetch(`/api/sessions/${encodeURIComponent(request.childSessionId)}?${params}`)
      .then(async (res) => {
        const data = await res.json() as { context?: SessionContext; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.context) {
          setError(data.error || t("ext.childTranscriptMissing"));
          return;
        }
        setContext(data.context);
      })
      .catch(() => {
        if (!cancelled) setError(t("ext.childTranscriptMissing"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, t]);

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
    <CenteredDialog
      width="min(820px, 92vw)"
      labelledBy="child-transcript-title"
      onClose={closeChildTranscript}
    >
      <div className="ext-dialog-scroll" style={{ maxHeight: "min(80vh, 720px)" }}>
        <div style={{ padding: "14px 14px 8px", display: "flex", alignItems: "baseline", gap: 8 }}>
          <div
            id="child-transcript-title"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}
          >
            {request.title?.trim() || t("ext.childTranscript")}
          </div>
          <button
            type="button"
            className="chrome-btn"
            onClick={() => void interrupt()}
            disabled={busy}
            style={{ marginLeft: "auto", height: 22, minHeight: 22, padding: "0 8px", fontSize: 11 }}
          >
            {t("ext.childInterrupt")}
          </button>
          <button
            type="button"
            className="chrome-btn"
            onClick={closeChildTranscript}
            style={{ height: 22, minHeight: 22, padding: "0 8px", fontSize: 11 }}
          >
            {t("common.close")}
          </button>
        </div>
        <div style={{ padding: "0 14px 14px" }}>
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
                />
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              className="input-base"
              value={draft}
              disabled={busy}
              placeholder={t("ext.childFollowup")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendFollowup();
                }
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !draft.trim()}
              onClick={() => void sendFollowup()}
              style={{ height: 28, padding: "0 10px", fontSize: 12 }}
            >
              {t("ext.childSend")}
            </button>
          </div>
        </div>
      </div>
    </CenteredDialog>
  );
}
