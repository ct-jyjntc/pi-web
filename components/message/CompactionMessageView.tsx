"use client";

import { useMemo } from "react";
import { MarkdownBody } from "../MarkdownBody";
import { useLocale } from "@/hooks/useLocale";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import type { CustomMessage } from "@/lib/types";
import { formatTime, getMessageText } from "./message-view-utils";

export function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useLocale();
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const time = formatTime(message.timestamp);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}>
            compaction
          </span>
          {time && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{time}</span>}
        </div>

        <div style={{ padding: "11px 13px 12px" }}>
          <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>
            {t("msg.conversationCompacted")}
          </div>
          <div style={{ marginTop: 3, marginBottom: 10, color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
            {t("msg.compactionSummaryIntro")}
          </div>
          {parsedSummary.body ? (
            <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
          ) : (
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("msg.noSummary")}</span>
          )}
          <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
        </div>
      </div>
    </div>
  );
}

export function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useLocale();
  const uniqueRead = Array.from(new Set(readFiles));
  const uniqueModified = Array.from(new Set(modifiedFiles));
  const total = uniqueRead.length + uniqueModified.length;
  if (total === 0) return null;

  const parts = [];
  if (uniqueRead.length > 0) parts.push(`${uniqueRead.length} ${t("msg.readFiles").toLowerCase()}`);
  if (uniqueModified.length > 0) parts.push(`${uniqueModified.length} ${t("msg.modifiedFiles").toLowerCase()}`);

  return (
    <details className="compaction-file-details">
      <summary>{t("msg.fileContext", { parts: parts.join(", ") })}</summary>
      {uniqueModified.length > 0 && <CompactionFileList title={t("msg.modifiedFiles")} files={uniqueModified} />}
      {uniqueRead.length > 0 && <CompactionFileList title={t("msg.readFiles")} files={uniqueRead} />}
    </details>
  );
}

export function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  // Compaction summaries can list the same path more than once — keep order,
  // drop exact duplicates so React keys stay unique.
  const uniqueFiles = Array.from(new Set(files));
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {uniqueFiles.map((file, index) => (
          <li key={`${index}:${file}`}>{file}</li>
        ))}
      </ul>
    </div>
  );
}


