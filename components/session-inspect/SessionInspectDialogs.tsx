/**
 * Session inspect popups (conversation branches + system prompt).
 * Opened from the sidebar session menu via session-inspect-store.
 * Matches ExtensionDialog / permission chrome (CenteredDialog + menu-card).
 */
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useLocale } from "@/hooks/useLocale";
import type { SessionTreeNode } from "@/lib/types";
import {
  closeSessionInspect,
  getSessionInspect,
  subscribeSessionInspect,
} from "@/lib/session-inspect-store";
import { CenteredDialog } from "../CenteredDialog";
import { BranchTree } from "../BranchNavigator";

export function SessionInspectDialogs({
  selectedSessionId,
  tree,
  activeLeafId,
  onLeafChange,
  systemPrompt,
  onSystemPrompt,
}: {
  selectedSessionId: string | null;
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  systemPrompt: string | null;
  onSystemPrompt: (prompt: string | null) => void;
}) {
  const { t } = useLocale();
  const inspect = useSyncExternalStore(subscribeSessionInspect, getSessionInspect, getSessionInspect);
  const matchedRef = useRef(false);

  const ready = !!inspect && selectedSessionId === inspect.sessionId;

  useEffect(() => {
    if (!inspect) {
      matchedRef.current = false;
      return;
    }
    if (selectedSessionId === inspect.sessionId) {
      matchedRef.current = true;
      return;
    }
    if (matchedRef.current) closeSessionInspect();
  }, [inspect, selectedSessionId]);

  useEffect(() => {
    if (!inspect || inspect.kind !== "system" || !ready || systemPrompt !== null) return;
    let cancelled = false;
    void sendAgentCommand<{ systemPrompt?: string }>(inspect.sessionId, { type: "get_state" })
      .then((data) => {
        if (cancelled || typeof data?.systemPrompt !== "string") return;
        onSystemPrompt(data.systemPrompt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inspect, ready, systemPrompt, onSystemPrompt]);

  if (!inspect) return null;

  const title = inspect.kind === "branches" ? t("branch.branches") : t("shell.systemPrompt");
  const loading = inspect.kind === "branches" ? t("branch.noSession") : t("shell.systemPromptLoad");
  const empty = !ready
    ? loading
    : inspect.kind === "system" && !systemPrompt
      ? (systemPrompt === "" ? t("shell.systemPromptEmpty") : t("shell.systemPromptLoad"))
      : null;

  return (
    <CenteredDialog width={440} labelledBy="session-inspect-title" onClose={closeSessionInspect}>
      <div className="ext-dialog-scroll">
        <div style={{ padding: "14px 14px 8px" }}>
          <div
            id="session-inspect-title"
            style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}
          >
            {title}
          </div>
          {empty ? (
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45, color: "var(--text-muted)" }}>
              {empty}
            </div>
          ) : inspect.kind === "system" ? (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--text-muted)",
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
              }}
            >
              {systemPrompt}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <BranchTree
                tree={tree}
                activeLeafId={activeLeafId}
                onLeafChange={onLeafChange}
                hasSession
              />
            </div>
          )}
        </div>
      </div>
      <div className="ext-dialog-footer">
        <div style={{ height: 1, background: "var(--border)" }} />
        <div style={{ padding: 4 }}>
          <button type="button" className="menu-row" onClick={closeSessionInspect}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </CenteredDialog>
  );
}
