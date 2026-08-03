"use client";

/**
 * Upload progress / conflict / summary strip for the file explorer.
 */
import { Check, CircleAlert, CircleMinus, Loader2, TriangleAlert, Upload, X, AtSign } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import type { PendingConflict, UploadPhase, UploadSummary } from "./types";

function DismissButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ width: 24, height: 24, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none", borderRadius: "var(--radius-xs)", background: "none", color: "var(--text-dim)", cursor: "pointer" }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text-muted)"; event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; event.currentTarget.style.background = "none"; }}
    >
      <Icon icon={X} size={13} strokeWidth={2.2} />
    </button>
  );
}

interface Props {
  uploadPhase: UploadPhase;
  uploadProgress: number;
  uploadError: string | null;
  uploadSummary: UploadSummary | null;
  pendingConflict: PendingConflict | null;
  onOverwrite: () => void;
  onSkip: () => void;
  onCancelConflict: () => void;
  onDismissError: () => void;
  onDismissSummary: () => void;
  onMentionUploaded?: () => void;
}

export function UploadFeedback({
  uploadPhase,
  uploadProgress,
  uploadError,
  uploadSummary,
  pendingConflict,
  onOverwrite,
  onSkip,
  onCancelConflict,
  onDismissError,
  onDismissSummary,
  onMentionUploaded,
}: Props) {
  const { t } = useLocale();
  const uploadBusy = uploadPhase !== "idle";
  const show = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;
  if (!show) return null;

  return (
    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
      {uploadBusy && (
        <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { n: uploadProgress })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 14, color: "var(--text-muted)" }}>
            {uploadPhase === "checking" ? (
              <Icon icon={Loader2} size={13} strokeWidth={2.2} style={{ animation: "spin 0.8s linear infinite" }} />
            ) : (
              <Icon icon={Upload} size={13} strokeWidth={2} />
            )}
            {uploadPhase === "uploading" && <span style={{ fontSize: 10 }}>{uploadProgress}%</span>}
          </div>
          {uploadPhase === "uploading" && (
            <div style={{ height: 3, marginTop: 4, overflow: "hidden", borderRadius: "var(--radius-xs)", background: "var(--border)" }}>
              <div style={{ width: `${uploadProgress}%`, height: "100%", background: "var(--text-muted)", transition: "width 120ms ease" }} />
            </div>
          )}
        </div>
      )}

      {pendingConflict && (
        <div role="alert" style={{ padding: 7, border: "1px solid color-mix(in oklab, var(--text-muted) 40%, var(--border))", borderRadius: "var(--radius-sm)", background: "color-mix(in oklab, var(--text-muted) 8%, var(--bg-panel))" }}>
          <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {t("files.alreadyExist", { n: pendingConflict.conflicts.length, names: pendingConflict.conflicts.join(", ") })}
          </div>
          {pendingConflict.nonReplaceable.length > 0 && (
            <div style={{ marginTop: 3, fontSize: 10, color: "var(--text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("files.cannotReplace", { names: pendingConflict.nonReplaceable.join(", ") })}
            </div>
          )}
          <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
            <button type="button" onClick={onOverwrite} style={{ height: 22, padding: "0 7px", border: "1px solid var(--destructive)", borderRadius: "var(--radius-xs)", background: "transparent", color: "var(--destructive)", cursor: "pointer", fontSize: 10 }}>
              {t("files.replace")}
            </button>
            <button type="button" onClick={onSkip} style={{ height: 22, padding: "0 7px", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 10 }}>
              {t("files.skipExisting")}
            </button>
            <button type="button" onClick={onCancelConflict} style={{ height: 22, padding: "0 7px", border: "none", borderRadius: "var(--radius-xs)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {uploadError && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, lineHeight: 1.35, color: "var(--destructive)" }}>
          <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{uploadError}</span>
          <DismissButton onClick={onDismissError} title={t("files.dismissError")} />
        </div>
      )}

      {uploadSummary && (
        <div aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22, fontSize: 11 }}>
            <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              {uploadSummary.uploaded.length > 0 && (
                <span title={`${uploadSummary.uploaded.length} uploaded`} aria-label={`${uploadSummary.uploaded.length} uploaded`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--success)" }}>
                  <Icon icon={Check} size={13} strokeWidth={2.4} />
                  <span>{uploadSummary.uploaded.length}</span>
                </span>
              )}
              {uploadSummary.skipped.length > 0 && (
                <span title={`${uploadSummary.skipped.length} skipped`} aria-label={`${uploadSummary.skipped.length} skipped`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)" }}>
                  <Icon icon={CircleMinus} size={13} strokeWidth={2} />
                  <span>{uploadSummary.skipped.length}</span>
                </span>
              )}
              {uploadSummary.errors.length > 0 && (
                <span title={`${uploadSummary.errors.length} failed`} aria-label={`${uploadSummary.errors.length} failed`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--destructive)" }}>
                  <Icon icon={TriangleAlert} size={13} strokeWidth={2} />
                  <span>{uploadSummary.errors.length}</span>
                </span>
              )}
            </div>
            {uploadSummary.uploaded.length > 0 && onMentionUploaded && (
              <button
                type="button"
                onClick={onMentionUploaded}
                title={uploadSummary.uploaded.length === 1 ? "Add uploaded file to chat" : "Add all uploaded files to chat"}
                aria-label={uploadSummary.uploaded.length === 1 ? "Add uploaded file to chat" : "Add all uploaded files to chat"}
                style={{ height: 22, padding: "0 7px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", background: "var(--bg-panel)", color: "var(--accent)", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                <Icon icon={AtSign} size={11} strokeWidth={2.2} />
                mention
              </button>
            )}
            <DismissButton onClick={onDismissSummary} title={t("files.dismissUpload")} />
          </div>
          {uploadSummary.errors.map((item) => (
            <div key={item.name} title={item.error} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, minWidth: 0, fontSize: 10, color: "var(--destructive)" }}>
              <Icon icon={CircleAlert} size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
