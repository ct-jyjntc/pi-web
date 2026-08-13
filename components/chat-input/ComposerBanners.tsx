"use client";

import { AlertTriangle, RefreshCw, Undo2 } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";
import type { QueuedMessages } from "@/hooks/useAgentSession";

export function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  const { t } = useLocale();
  return (
    <div className="composer-queue-row" title={text}>
      <span className={`composer-queue-badge${kind === "steer" ? " is-steer" : ""}`}>
        {kind === "steer" ? t("chat.badgeSteer") : t("chat.badgeFollowUp")}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

export function ComposerQueueBanner({
  queued,
  onRecall,
}: {
  queued?: QueuedMessages | null;
  onRecall?: () => void;
}) {
  const { t } = useLocale();
  const n = (queued?.steering.length ?? 0) + (queued?.followUp.length ?? 0);
  if (n === 0) return null;
  return (
    <div className="composer-queue">
      <div className="composer-queue-head">
        <span className="composer-queue-label">{t("chat.queued", { n })}</span>
        {onRecall && (
          <button
            type="button"
            className="chrome-btn"
            onClick={onRecall}
            title={t("chat.recallQueueTitle")}
          >
            <Icon icon={Undo2} size={13} strokeWidth={2} />
            <span>{t("chat.recallQueue")}</span>
          </button>
        )}
      </div>
      {queued?.steering.map((text, i) => (
        <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
      ))}
      {queued?.followUp.map((text, i) => (
        <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
      ))}
    </div>
  );
}

export function ComposerRetryBanner({
  retryInfo,
}: {
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
}) {
  const { t } = useLocale();
  if (!retryInfo) return null;
  return (
    <div className="composer-retry" role="status">
      <Icon icon={RefreshCw} size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span>
        {t("chat.retrying", { n: retryInfo.attempt, m: retryInfo.maxAttempts })}
        {retryInfo.errorMessage ? (
          <span className="composer-retry-detail"> — {retryInfo.errorMessage}</span>
        ) : null}
      </span>
    </div>
  );
}

export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] | null }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div
      role="status"
      style={{
        marginBottom: 8,
        padding: "7px 10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-subtle)",
        color: "var(--text-muted)",
        fontSize: 11,
        lineHeight: 1.45,
        fontFamily: "var(--font-mono)",
        whiteSpace: "pre-wrap",
      }}
    >
      {warnings.join("\n")}
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useLocale();
  if (!error) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        maxHeight: 120,
        marginBottom: 8,
        padding: "7px 10px",
        overflowY: "auto",
        border: "1px solid var(--destructive-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--destructive-bg)",
        color: "var(--destructive)",
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <Icon icon={AlertTriangle} size={13} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{t("chat.modelError")}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error}</div>
      </div>
    </div>
  );
}

