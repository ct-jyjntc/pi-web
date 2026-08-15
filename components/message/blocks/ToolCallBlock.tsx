"use client";

import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Icon } from "../../Icon";
import { useLocale } from "@/hooks/useLocale";
import { formatThoughtDuration } from "@/lib/message-display";
import { MAX_DIFF_ROWS, parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import { isRecord } from "@/lib/type-guards";
import type { ToolCardKind } from "@/lib/tool-presentation";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { requestChildTranscript } from "@/lib/child-transcript-store";
import { childSessionIdFromTool } from "@/lib/first-party/subagents/identity";
import { useAskUserRequest } from "@/lib/ask-user-store";
import { AskUserCard } from "../AskUserCard";
import { getToolPreview } from "../message-view-utils";
import { scaffoldToolTitle } from "../tool-run-meta";

export function cardChrome(card: ToolCardKind): { accent: string; bg: string; border: string } {
  if (card === "ask") {
    return {
      accent: "var(--accent)",
      bg: "color-mix(in oklab, var(--accent) 5%, var(--bg))",
      border: "color-mix(in oklab, var(--accent) 25%, var(--border))",
    };
  }
  return {
    accent: "var(--success)",
    bg: "var(--success-bg)",
    border: "var(--success-border)",
  };
}

export function parseEditFailureKind(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/Edit failed \(([^)]+)\)/i);
  return m?.[1] ?? null;
}

export const ToolCallBlock = memo(function ToolCallBlock({
  block,
  result,
  duration,
  isStreaming,
  nested,
  sessionId,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  isStreaming?: boolean;
  /** Rendered under a ToolRunGroup summary — slightly tighter indent chrome. */
  nested?: boolean;
  sessionId?: string;
}) {
  const { t } = useLocale();
  const askRequest = useAskUserRequest();
  const card = block.presentation?.card ?? "generic";
  const isCard = card === "diff" || card === "ask";
  const isDiffCard = card === "diff";
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "" || resultText.trim() === "（无输出）");
  const isError = result?.isError ?? false;
  const resultDiff = !isError && block.presentation?.patch ? { text: block.presentation.patch } : null;
  const pending = Boolean(isStreaming) && !result;
  const showAskForm = card === "ask" && !result && askRequest != null;

  const [scaffoldUserOpen, setScaffoldUserOpen] = useState<boolean | null>(null);
  const [cardUserOpen, setCardUserOpen] = useState<boolean | null>(null);
  // Errors stay folded by default — the red title marks the row; click to unfold.
  const scaffoldExpanded = scaffoldUserOpen ?? false;
  const cardExpanded = cardUserOpen ?? ((isDiffCard && !isError) || showAskForm);
  const showScaffoldArgs = !isCard && scaffoldExpanded;
  const showCardArgs = isCard && cardExpanded && !isDiffCard && !showAskForm;
  const showInputArgs = showScaffoldArgs || showCardArgs;
  const inputStr = useMemo(
    () => (showInputArgs ? JSON.stringify(block.input, null, 2) : ""),
    [showInputArgs, block.input],
  );
  const editMeta = result && !result.isError && isDiffCard ? getEditResultMeta(result) : null;
  const editFailureKind = isDiffCard && isError ? parseEditFailureKind(resultText) : null;
  const meta = cardChrome(card);
  const preview = block.presentation?.title || block.presentation?.preview || getToolPreview(block);
  const childSessionId = childSessionIdFromTool({
    toolName: block.toolName,
    details: result?.details,
    resultText,
  });
  const longResult = (resultText?.length ?? 0) > 1200;
  const showResultCollapsed = isCard && !cardExpanded && !isError && result && longResult && !resultDiff;

  // ── Hermes scaffold row for activity tools (read/bash/grep/…) ──────────
  // Default collapsed one-liner; expand for args/result. Cards (diff/ask)
  // keep the heavier bordered chrome below.
  if (!isCard) {
    const title = scaffoldToolTitle(block, pending, t);
    const hasBody = Boolean(result) || Object.keys(block.input ?? {}).length > 0;
    const expanded = scaffoldExpanded;

    return (
      <div
        data-slot="tool-row"
        data-tool-open={expanded ? "" : undefined}
        style={{
          color: isError ? "var(--destructive)" : "var(--text-muted)",
          fontSize: 12,
          lineHeight: 1.45,
          opacity: pending ? 0.9 : 0.82,
          paddingLeft: nested ? 14 : 0,
        }}
      >
        <button
          type="button"
          aria-expanded={hasBody ? expanded : undefined}
          onClick={() => {
            if (!hasBody) return;
            setScaffoldUserOpen(!expanded);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            minHeight: 22,
            padding: "1px 0",
            background: "none",
            border: "none",
            color: "inherit",
            cursor: hasBody ? "pointer" : "default",
            textAlign: "left",
            minWidth: 0,
          }}
        >
          {hasBody ? (
            <Icon
              icon={ChevronRight}
              size={10}
              strokeWidth={1.6}
              style={{
                flexShrink: 0,
                opacity: 0.55,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.15s ease",
              }}
            />
          ) : (
            <span
              aria-hidden
              className={pending ? "tool-run-live" : undefined}
              style={{
                width: 6,
                height: 6,
                borderRadius: 2,
                background: "var(--text-dim)",
                flexShrink: 0,
                opacity: 0.65,
              }}
            />
          )}
          <span
            className={pending ? "tool-run-live" : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          {duration !== undefined && duration > 0 && !pending && (
            <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {formatThoughtDuration(duration)}
            </span>
          )}
        </button>
        {childSessionId && sessionId ? (
          <button
            type="button"
            className="chrome-btn"
            onClick={() => {
              requestChildTranscript({
                childSessionId,
                parentSessionId: sessionId,
                title: preview,
              });
            }}
            style={{ marginLeft: 17, height: 20, minHeight: 20, padding: "0 6px", fontSize: 11 }}
          >
            {t("ext.viewTranscript")}
          </button>
        ) : null}
        {expanded && (
          <div style={{ marginTop: 4, marginLeft: 17, display: "flex", flexDirection: "column", gap: 6 }}>
            {showScaffoldArgs && inputStr && inputStr !== "{}" && (
              <pre
                style={{
                  margin: 0,
                  padding: "6px 8px",
                  color: "var(--text-muted)",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  overflow: "auto",
                  maxHeight: 160,
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {inputStr}
              </pre>
            )}
            {result && (
              resultDiff ? (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                  <PairedDiffResult diff={resultDiff} />
                </div>
              ) : (
                <div
                  style={{
                    border: isError ? "1px solid var(--destructive-border)" : "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    background: isError ? "var(--destructive-bg)" : "var(--bg-subtle)",
                  }}
                >
                  <PairedResult
                    text={resultText ?? ""}
                    isEmpty={resultIsEmpty}
                    isError={isError}
                  />
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Card tools (diff / ask) — keep full chrome + diffs ─────────
  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        fontSize: 12,
        border: isError ? "1px solid var(--destructive-border)" : `1px solid ${showAskForm ? "var(--border)" : meta.border}`,
        background: isError ? "var(--destructive-bg)" : showAskForm ? "var(--bg)" : meta.bg,
      }}
    >
      <button
        type="button"
        aria-expanded={cardExpanded}
        onClick={() => setCardUserOpen(!cardExpanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "7px 11px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: isError ? "var(--destructive)" : meta.accent, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {block.toolName}
        </span>
        {editFailureKind && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--destructive)",
              border: "1px solid var(--destructive-border)",
              background: "var(--destructive-bg)",
              borderRadius: "var(--radius-xs)",
              padding: "1px 5px",
            }}
          >
            {editFailureKind}
          </span>
        )}
        {editMeta?.mode && !isError && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              letterSpacing: "0.03em",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              background: "var(--bg-subtle)",
              borderRadius: "var(--radius-xs)",
              padding: "1px 5px",
            }}
            title={editMeta.mode}
          >
            {editMeta.modeLabel}
          </span>
        )}
        {editMeta?.tag && !isError && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--success)",
              border: "1px solid var(--success-border)",
              background: "var(--success-bg)",
              borderRadius: "var(--radius-xs)",
              padding: "1px 5px",
            }}
            title="New hashline file tag after edit"
          >
            #{editMeta.tag}
          </span>
        )}
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {showAskForm ? t("ask.title") : preview}
        </span>
        {duration !== undefined && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
        {showResultCollapsed && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>…</span>
        )}
        <Icon
          icon={ChevronDown}
          size={10}
          strokeWidth={1.6}
          style={{
            flexShrink: 0,
            color: "var(--text-dim)",
            transform: cardExpanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {showAskForm && askRequest ? (
        <AskUserCard request={askRequest} sessionId={sessionId} />
      ) : null}

      {showInputArgs && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12.5,
            lineHeight: 1.5,
            overflow: "auto",
            background: "var(--bg-subtle)",
            borderTop: isError ? "1px solid var(--destructive-border)" : `1px solid ${meta.border}`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {inputStr}
        </pre>
      )}

      {result && (cardExpanded || (!isError && !longResult && !resultDiff)) && (
        resultDiff ? (
          <PairedDiffResult diff={resultDiff} />
        ) : (
          <PairedResult
            text={resultText ?? ""}
            isEmpty={resultIsEmpty}
            isError={isError}
          />
        )
      )}
      {showResultCollapsed && resultText && (
        <div
          style={{
            padding: "6px 11px 8px",
            borderTop: isError ? "1px solid var(--destructive-border)" : `1px solid ${meta.border}`,
            color: "var(--text-dim)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {resultText.replace(/\s+/g, " ").slice(0, 140)}…
        </div>
      )}
    </div>
  );
});

interface ResultDiff {
  text: string;
}

export function PairedDiffResult({ diff }: {
  diff: ResultDiff;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--success-border)",
        background: "var(--bg)",
      }}
    >
      <SplitPatchView text={diff.text} />
    </div>
  );
}

export const SplitPatchView = memo(function SplitPatchView({ text }: { text: string }) {
  const { t } = useLocale();
  const [showAllRows, setShowAllRows] = useState(false);
  // Big edits are capped so a transcript of long diffs cannot blow up the DOM;
  // the full patch is only parsed/rendered after an explicit click.
  const files = useMemo(
    () => parseUnifiedPatch(text, showAllRows ? undefined : { maxRows: MAX_DIFF_ROWS }),
    [text, showAllRows],
  );
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;
  const hiddenRows = files.reduce((sum, file) => sum + (file.hiddenRows ?? 0), 0);

  return (
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          {showFileHeaders && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--bg-panel)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <SplitDiffHeader title={file.oldPath || t("msg.diffBefore")} side="left" />
              <SplitDiffHeader title={file.newPath || t("msg.diffAfter")} side="right" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {hiddenRows > 0 && (
        <button
          type="button"
          onClick={() => setShowAllRows(true)}
          style={{
            display: "block",
            position: "sticky",
            bottom: 0,
            zIndex: 1,
            width: "100%",
            padding: "6px 10px",
            border: "none",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            textAlign: "left",
          }}
        >
          {t("msg.showMore")} (+{hiddenRows})
        </button>
      )}
    </div>
  );
});

export function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--text-dim)",
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

export const SplitDiffCellView = memo(function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "var(--diff-add-bg)"
      : cell.type === "removed"
      ? "var(--diff-del-bg)"
      : cell.type === "empty"
      ? "var(--bg-subtle)"
      : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "var(--success)" : cell.type === "removed" ? "var(--destructive)" : "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: cell.type === "empty" ? "var(--text-dim)" : "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
});

export function PatchTextView({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);

  return (
    <div style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.55, minWidth: 0 }}>
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bg =
          kind === "added" ? "var(--diff-add-bg)" :
          kind === "removed" ? "var(--diff-del-bg)" :
          kind === "hunk" ? "var(--diff-hunk-bg)" :
          "transparent";
        const color =
          kind === "added" ? "var(--success)" :
          kind === "removed" ? "var(--destructive)" :
          kind === "hunk" ? "var(--accent)" :
          "var(--text)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft: kind === "added"
                ? "3px solid var(--success)"
                : kind === "removed"
                ? "3px solid var(--destructive)"
                : kind === "hunk"
                ? "3px solid var(--accent)"
                : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ padding: "0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color }}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function getEditResultMeta(result: ToolResultMessage): { mode?: string; modeLabel: string; tag?: string } | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) {
    // Fallback: parse "→ #ABCD" from result text
    const text = result.content
      ?.filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n") ?? "";
    const tagMatch = text.match(/→\s*#([0-9A-Fa-f]{4})\b/) ?? text.match(/#([0-9A-Fa-f]{4})\b/);
    if (!tagMatch) return null;
    return { modeLabel: "hashline", tag: tagMatch[1]!.toUpperCase() };
  }

  const mode = typeof details.mode === "string" ? details.mode : undefined;
  let tag = typeof details.tag === "string" ? details.tag.split(",")[0]?.trim() : undefined;
  if (!tag && Array.isArray(details.results) && details.results[0] && isRecord(details.results[0])) {
    const t = details.results[0].tag;
    if (typeof t === "string") tag = t;
  }
  if (tag) tag = tag.replace(/^#/, "").toUpperCase();

  const modeLabel =
    mode === "hashline-patch" ? "hashline"
      : mode === "hashline-hunks" ? "hunks"
        : mode === "classic-via-hashline" ? "strict"
          : mode === "classic-fuzzy" ? "classic"
            : mode ? mode.replace(/-/g, " ").slice(0, 16) : "edit";

  if (!mode && !tag) return null;
  return { mode, modeLabel, tag };
}


export function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "var(--destructive-border)" : "var(--success-border)"}`,
        background: isError ? "var(--destructive-bg)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "var(--destructive)" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12.5,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
          background: "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? "—" : text}
      </pre>
    </div>
  );
}
