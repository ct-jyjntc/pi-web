"use client";

import { useLocale } from "@/hooks/useLocale";
import type { MessageKey } from "@/lib/i18n/messages";

import { useEffect, useState, useRef, useCallback, type CSSProperties, type MouseEvent } from "react";
import {
  SyntaxHighlighter,
  createSyntaxElement as renderSyntaxNode,
  getCodeThemeStyle,
  type SyntaxHighlighterProps,
} from "@/lib/syntax-highlighter";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import { useAppearance } from "@/lib/appearance-store";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { resolveLocalFileHref } from "@/lib/file-links";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins } from "@/lib/markdown";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  gitRefreshKey?: number;
}

interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

function MentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function closestSourceLine(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest<HTMLElement>(".file-source-line[data-line-number]") ?? null;
}

function getSelectedSourceLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  let startElement = closestSourceLine(range.startContainer);
  let endElement = closestSourceLine(range.endContainer);
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) return null;

  let startLine = Number(startElement.dataset.lineNumber);
  let endLine = Number(endElement.dataset.lineNumber);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;

  if (startLine < endLine) {
    // Browser ranges can start at the end of the preceding line or end at the
    // start of the following line. Exclude either boundary line when none of
    // its source text is actually selected.
    const startContent = startElement.querySelector<HTMLElement>(".file-source-line-content");
    if (startContent?.contains(range.startContainer)) {
      const selectedSuffix = document.createRange();
      selectedSuffix.selectNodeContents(startContent);
      selectedSuffix.setStart(range.startContainer, range.startOffset);
      if (selectedSuffix.toString().length === 0) {
        const nextLine = startElement.nextElementSibling;
        if (nextLine instanceof HTMLElement && nextLine.matches(".file-source-line[data-line-number]")) {
          startElement = nextLine;
          startLine = Number(startElement.dataset.lineNumber);
        }
      }
    }

    const endContent = endElement.querySelector<HTMLElement>(".file-source-line-content");
    if (endContent?.contains(range.endContainer)) {
      const selectedPrefix = document.createRange();
      selectedPrefix.selectNodeContents(endContent);
      selectedPrefix.setEnd(range.endContainer, range.endOffset);
      if (selectedPrefix.toString().length === 0) {
        const previousLine = endElement.previousElementSibling;
        if (previousLine instanceof HTMLElement && previousLine.matches(".file-source-line[data-line-number]")) {
          endElement = previousLine;
          endLine = Number(endElement.dataset.lineNumber);
        }
      }
    }
  }

  if (startLine > endLine) return null;
  return { startLine, endLine };
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

type DisplayMode = "source" | "preview" | "diff";

const DISPLAY_MODE_LABELS: Record<DisplayMode, MessageKey> = {
  source: "viewer.source",
  preview: "viewer.preview",
  diff: "viewer.diff",
};

const FILE_CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  lineHeight: 1.6,
};

const FILE_LINE_NUMBER_STYLE: CSSProperties = {
  width: 48,
  minWidth: 48,
  padding: "0 10px",
  textAlign: "right",
  color: "var(--text-dim)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontStyle: "normal",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "20.8px",
  userSelect: "none",
  flexShrink: 0,
  verticalAlign: "top",
};

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
};

type LineDiagnostic = { severity: "error" | "warning" | "info"; message: string; code?: string };

function SourceCodeRenderer({
  rows,
  stylesheet,
  useInlineStyles,
  wrapLines,
  diagnosticsByLine,
}: SourceCodeRendererProps & {
  diagnosticsByLine?: Map<number, LineDiagnostic[]>;
}) {
  return rows.map((row, lineIndex) => {
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber = Array.isArray(firstChildClasses)
      && firstChildClasses.includes("react-syntax-highlighter-line-number");
    const lineNumberNode = hasLineNumber ? children[0] : null;
    const contentNodes = hasLineNumber ? children.slice(1) : children;
    const lineNo = lineIndex + 1;
    const diags = diagnosticsByLine?.get(lineNo);
    const worst = diags?.some((d) => d.severity === "error")
      ? "error"
      : diags?.some((d) => d.severity === "warning")
        ? "warning"
        : diags?.length
          ? "info"
          : null;
    const gutterColor = worst === "error"
      ? "var(--destructive)"
      : worst === "warning"
        ? "var(--text)"
        : worst === "info"
          ? "var(--text-muted)"
          : undefined;
    const title = diags?.map((d) => `${d.severity.toUpperCase()}${d.code ? ` ${d.code}` : ""}: ${d.message}`).join("\n");

    return (
      <span
        className="file-source-line"
        data-line-number={lineNo}
        key={`source-line-${lineIndex}`}
        title={title}
        style={{
          display: "flex",
          minWidth: "100%",
          background: worst === "error"
            ? "color-mix(in oklab, var(--destructive) 10%, transparent)"
            : worst === "warning"
              ? "color-mix(in oklab, var(--text) 6%, transparent)"
              : undefined,
          boxShadow: gutterColor ? `inset 3px 0 0 ${gutterColor}` : undefined,
        }}
      >
        {lineNumberNode && renderSyntaxNode({
          node: lineNumberNode,
          stylesheet,
          useInlineStyles,
          key: `source-line-number-${lineIndex}`,
        })}
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {contentNodes.map((node, tokenIndex) => renderSyntaxNode({
            node,
            stylesheet,
            useInlineStyles,
            key: `source-token-${lineIndex}-${tokenIndex}`,
          }))}
        </span>
      </span>
    );
  });
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encoded}?${searchParams.toString()}`;
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useLocale();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("viewer.download")}
      aria-label={t("viewer.download")}
      className="file-viewer-icon-button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

type DiffLine = {
  type: "unchanged" | "removed" | "added";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diffLines(patch: string): DiffLine[] {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];

  return files.flatMap((file) => file.rows.flatMap((row): DiffLine[] => {
    if (row.type === "hunk") return [];
    if (row.left.type === "context" && row.right.type === "context") {
      return [{
        type: "unchanged",
        text: row.right.text,
        oldLineNo: row.left.lineNo,
        newLineNo: row.right.lineNo,
      }];
    }

    const lines: DiffLine[] = [];
    if (row.left.type === "removed") {
      lines.push({
        type: "removed",
        text: row.left.text,
        oldLineNo: row.left.lineNo,
        newLineNo: null,
      });
    }
    if (row.right.type === "added") {
      lines.push({
        type: "added",
        text: row.right.text,
        oldLineNo: null,
        newLineNo: row.right.lineNo,
      });
    }
    return lines;
  }));
}

export function DiffView({ patch, wrapLines = true }: { patch: string; wrapLines?: boolean }) {
  const diff = diffLines(patch);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        No changes
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  return (
    <div
      className={`file-diff-view${wrapLines ? " is-wrapped" : ""}`}
      style={{
        width: wrapLines ? "100%" : "max-content",
        minWidth: "100%",
        ...FILE_CODE_STYLE,
      }}
    >
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              className="file-diff-collapsed"
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const bg =
            line.type === "added"
              ? "var(--diff-add-bg)"
              : line.type === "removed"
              ? "var(--diff-del-bg)"
              : "transparent";
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "var(--success)" : line.type === "removed" ? "var(--destructive)" : "var(--text-dim)";

          return (
            <div
              key={li}
              className={`file-diff-line file-diff-line-${line.type}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                width: "100%",
                minWidth: 0,
                background: bg,
                borderLeft: line.type === "added"
                  ? "3px solid var(--success)"
                  : line.type === "removed"
                  ? "3px solid var(--destructive)"
                  : "3px solid transparent",
              }}
            >
              <span style={FILE_LINE_NUMBER_STYLE}>
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                  lineHeight: "20.8px",
                }}
              >
                {prefix}
              </span>
              <span
                className="file-diff-line-content"
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  padding: "0 10px 0 0",
                  whiteSpace: wrapLines ? "pre-wrap" : "pre",
                  overflowWrap: wrapLines ? "anywhere" : "normal",
                  wordBreak: wrapLines ? "break-word" : "normal",
                  color: "var(--text)",
                }}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({
  filePath, cwd, sourceSessionId }: Props) {
  const { t } = useLocale();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <span
          title={watching ? t("viewer.liveSync") : t("viewer.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "var(--success)" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "var(--destructive)", fontSize: 13 }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError(t("viewer.failedImage"))}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "var(--shadow-md)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({
  filePath, cwd, sourceSessionId }: Props) {
  const { t } = useLocale();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("viewer.liveSync") : t("viewer.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "var(--success)" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "var(--destructive)", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(t("viewer.failedAudio"))}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({
  filePath, cwd, sourceSessionId }: Props) {
  const { t } = useLocale();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = isPdf
    ? getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError(t("viewer.docxTooLarge"));
          }
        }
      })
      .catch((e) => setError(String(e)));

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError(t("viewer.docxTooLarge"));
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, isPdf, sourceSessionId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatSize(size)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <span
          title={watching ? t("viewer.liveSync") : t("viewer.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "var(--success)" : "var(--text-dim)", flexShrink: 0 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "var(--destructive)", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : ""}
            title={`Preview ${getFileName(filePath)}`}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "var(--bg-panel)" }}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({ filePath, cwd, sourceSessionId, onOpenFile, onMentionLines, gitRefreshKey }: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} onOpenFile={onOpenFile} onMentionLines={onMentionLines} gitRefreshKey={gitRefreshKey} />;
}

function TextFileViewer({ filePath, cwd, sourceSessionId, onOpenFile, onMentionLines, gitRefreshKey }: Props) {
  const { t } = useLocale();
  const { isDark } = useTheme();
  const appearance = useAppearance();
  const codeThemeStyle = getCodeThemeStyle(
    isDark ? appearance.codeThemeDark : appearance.codeThemeLight,
    isDark,
  );
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("source");
  const [wrapLines, setWrapLines] = useState(true);
  const [watching, setWatching] = useState(false);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);
  const [diagnosticsByLine, setDiagnosticsByLine] = useState<Map<number, LineDiagnostic[]>>(new Map());
  const [diagList, setDiagList] = useState<Array<LineDiagnostic & { line: number; column?: number }>>([]);
  const [diagPanelOpen, setDiagPanelOpen] = useState(false);
  const [diagSummary, setDiagSummary] = useState<{ errors: number; warnings: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const gitDiffRequestRef = useRef(0);
  const contentRequestRef = useRef(0);
  const contentPathRef = useRef(filePath);
  contentPathRef.current = filePath;
  const contentRef = useRef<HTMLDivElement | null>(null);

  const fetchContent = useCallback((targetPath: string) => {
    const requestId = ++contentRequestRef.current;
    return fetch(getFileApiUrl(targetPath, "read", sourceSessionId))
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (requestId !== contentRequestRef.current || contentPathRef.current !== targetPath) {
          return null;
        }
        if (d.error) {
          setError(d.error);
          return null;
        }
        setError(null);
        setData(d);
        return d;
      })
      .catch((e) => {
        if (requestId !== contentRequestRef.current || contentPathRef.current !== targetPath) {
          return null;
        }
        setError(String(e));
        return null;
      });
  }, [sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    const requestId = ++gitDiffRequestRef.current;
    if (!cwd) {
      setGitDiff(null);
      return;
    }

    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/git/diff?${params.toString()}`);
      const next = await response.json() as GitFileDiffResponse & { error?: string };
      if (requestId !== gitDiffRequestRef.current) return;
      setGitDiff(response.ok && next.supported && typeof next.patch === "string" ? next : null);
    } catch {
      if (requestId === gitDiffRequestRef.current) setGitDiff(null);
    }
  }, [cwd]);

  const fetchDiagnostics = useCallback(async (targetPath: string) => {
    if (!cwd) {
      setDiagnosticsByLine(new Map());
      setDiagList([]);
      setDiagSummary(null);
      return;
    }
    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/diagnostics?${params.toString()}`);
      const next = await response.json() as {
        items?: Array<{ line?: number; column?: number; severity?: string; message?: string; code?: string; filePath?: string }>;
      };
      if (!response.ok) {
        setDiagnosticsByLine(new Map());
        setDiagList([]);
        setDiagSummary(null);
        return;
      }
      const map = new Map<number, LineDiagnostic[]>();
      const list: Array<LineDiagnostic & { line: number; column?: number }> = [];
      let errors = 0;
      let warnings = 0;
      for (const item of next.items ?? []) {
        const line = Number(item.line) || 1;
        const severity: LineDiagnostic["severity"] =
          item.severity === "error" || item.severity === "warning" || item.severity === "info"
            ? item.severity
            : "info";
        if (severity === "error") errors += 1;
        else if (severity === "warning") warnings += 1;
        const entry = {
          severity,
          message: item.message ?? "",
          code: item.code,
          line,
          column: typeof item.column === "number" ? item.column : undefined,
        };
        const bucket = map.get(line) ?? [];
        bucket.push(entry);
        map.set(line, bucket);
        list.push(entry);
      }
      setDiagnosticsByLine(map);
      setDiagList(list);
      setDiagSummary(errors + warnings > 0 || list.length > 0 ? { errors, warnings } : null);
      if (list.length > 0) setDiagPanelOpen(true);
    } catch {
      setDiagnosticsByLine(new Map());
      setDiagList([]);
      setDiagSummary(null);
    }
  }, [cwd]);

  // Initial load + SSE watch setup
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setGitDiff(null);
    setDisplayMode("source");
    setWrapLines(false);
    setWatching(false);
    setDiagnosticsByLine(new Map());
    setDiagList([]);
    setDiagSummary(null);
    setDiagPanelOpen(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetchContent(filePath).then((d) => {
      if (d?.language === "markdown") setDisplayMode("preview");
    }).finally(() => setLoading(false));
    void fetchDiagnostics(filePath);

    // Set up SSE watch
    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", () => {
      void fetchContent(filePath);
      void fetchGitDiff(filePath);
    });

    es.addEventListener("error", () => {
      setWatching(false);
    });

    es.onerror = () => {
      setWatching(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent, fetchDiagnostics, fetchGitDiff, sourceSessionId]);

  useEffect(() => {
    void fetchGitDiff(filePath);
  }, [fetchGitDiff, filePath, gitRefreshKey]);

  useEffect(() => {
    void fetchDiagnostics(filePath);
  }, [fetchDiagnostics, filePath, gitRefreshKey]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";

  useEffect(() => {
    if (!hasGitDiff && displayMode === "diff") setDisplayMode("source");
  }, [displayMode, hasGitDiff]);

  useEffect(() => {
    const updateSelectedLineRange = () => {
      const root = contentRef.current;
      setSelectedLineRange(
        onMentionLines && displayMode === "source" && root
          ? getSelectedSourceLineRange(root, window.getSelection())
          : null,
      );
    };

    updateSelectedLineRange();
    if (!onMentionLines || displayMode !== "source") return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [data?.content, displayMode, onMentionLines]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    if (!onMentionLines || !lineRange) return;
    onMentionLines(
      getRelativeFilePath(filePath, cwd),
      lineRange.startLine,
      lineRange.endLine,
    );
  }, [cwd, filePath, onMentionLines]);

  const handleMentionSelectedLines = useCallback(() => {
    mentionLineRange(selectedLineRange);
  }, [mentionLineRange, selectedLineRange]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "i") return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;

      const root = contentRef.current;
      const lineRange = root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, mentionLineRange, onMentionLines]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--destructive)", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const hasPreview = isHtml || isMarkdown;
  const markdownDirectory = getFileDirectory(filePath);
  const lines = data.content.split("\n");
  const displayModes: DisplayMode[] = [
    "source",
    ...(hasPreview ? ["preview" as const] : []),
    ...(hasGitDiff ? ["diff" as const] : []),
  ];
  const metadata = `${data.language} · ${lines.length} lines · ${formatSize(data.size)}`;

  return (
    <div className="file-viewer-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        className="file-viewer-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span className="file-viewer-path" style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>

        <span className="file-viewer-meta" title={metadata}>{metadata}</span>
        {(diagSummary || diagList.length > 0) && (
          <button
            type="button"
            className="chrome-btn"
            onClick={() => setDiagPanelOpen((v) => !v)}
            title="Toggle diagnostics panel"
            style={{
              height: 22,
              minHeight: 22,
              padding: "0 8px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              color: (diagSummary?.errors ?? 0) > 0 ? "var(--destructive)" : "var(--text-muted)",
            }}
          >
            {(diagSummary?.errors ?? 0) > 0 ? `${diagSummary?.errors} err` : "0 err"}
            {" · "}
            {(diagSummary?.warnings ?? 0) > 0 ? `${diagSummary?.warnings} warn` : "0 warn"}
            {diagPanelOpen ? " ▾" : " ▸"}
          </button>
        )}
        <span
          title={watching ? t("viewer.liveSync") : t("viewer.notWatching")}
          aria-label={watching ? t("viewer.liveSync") : t("viewer.notWatching")}
          className="file-viewer-live-indicator"
          style={{
            background: watching ? "var(--success)" : "var(--border)",
            boxShadow: watching ? "0 0 4px var(--success)" : "none",
          }}
        />

        <div className="file-viewer-controls">
          {displayModes.length > 1 && (
            <div className="file-viewer-mode-switch" aria-label={t("viewer.viewMode")}>
              {displayModes.map((mode) => {
                const active = displayMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDisplayMode(mode)}
                    title={mode === "diff" ? t("viewer.compareHead") : undefined}
                    aria-pressed={active}
                    className="file-viewer-mode-button"
                    style={{
                      background: active ? "var(--bg-selected)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {t(DISPLAY_MODE_LABELS[mode])}
                  </button>
                );
              })}
            </div>
          )}

          <div className="file-viewer-actions">
            {displayMode === "source" && (
              <>
                {onMentionLines && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleMentionSelectedLines}
                    title={t("viewer.mentionLinesShortcut")}
                    aria-label={t("viewer.mentionLines")}
                    disabled={!selectedLineRange}
                    className="file-viewer-icon-button"
                  >
                    <MentionIcon />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setWrapLines((value) => !value)}
                  title={wrapLines ? t("viewer.disableWrap") : t("viewer.enableWrap")}
                  aria-label={wrapLines ? t("viewer.disableWrap") : t("viewer.enableWrap")}
                  aria-pressed={wrapLines}
                  className="file-viewer-icon-button"
                  style={{
                    background: wrapLines ? "var(--bg-selected)" : "transparent",
                    color: wrapLines ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                    <path d="m16 16-2 2 2 2" />
                    <path d="M3 18h7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        </div>
      </div>

      {/* Content area + diagnostics panel */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={contentRef} className="file-viewer-content" style={{ flex: 1, overflow: "auto", background: "var(--bg)", minHeight: 0 }}>
        {displayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} />
        ) : isHtml && displayMode === "preview" ? (
          <iframe
            srcDoc={data.content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title={t("viewer.htmlPreview")}
          />
        ) : isMarkdown && displayMode === "preview" ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ padding: "24px 32px" }}
          >
            <ReactMarkdown
              remarkPlugins={markdownPreviewRemarkPlugins}
              rehypePlugins={markdownPreviewRehypePlugins}
              components={{
                a({ href, children, ...props }) {
                  delete props.node;
                  const linkedFile = onOpenFile
                    ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  if (!linkedFile || !onOpenFile) {
                    return <a href={href} {...props}>{children}</a>;
                  }

                  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (event.defaultPrevented || event.button !== 0) return;
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onOpenFile(linkedFile);
                  };

                  return <a href={href} {...props} onClick={handleClick}>{children}</a>;
                },
                img({ src, alt, ...props }) {
                  delete props.node;
                  const imagePath = typeof src === "string"
                    ? resolveLocalFileHref(src, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  const imageSrc = imagePath
                    ? getFileApiUrl(imagePath, "read", sourceSessionId)
                    : src;
                  // Dynamic local paths are served directly by the file API.
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
                },
              }}
            >
              {data.content}
            </ReactMarkdown>
          </div>
        ) : (
          <SyntaxHighlighter
            className={(wrapLines || appearance.wrapCodeLines) ? "file-source-view is-wrapped" : "file-source-view"}
            language={data.language === "text" ? "plaintext" : data.language}
            style={codeThemeStyle}
            showLineNumbers={appearance.showCodeLineNumbers}
            lineNumberStyle={{
              ...FILE_LINE_NUMBER_STYLE,
              fontSize: appearance.codeFontSize,
            }}
            customStyle={{
              margin: 0,
              padding: 0,
              border: 0,
              backgroundColor: "var(--bg)",
              ...FILE_CODE_STYLE,
              fontSize: appearance.codeFontSize,
              width: (wrapLines || appearance.wrapCodeLines) ? "100%" : "max-content",
              minWidth: "100%",
              minHeight: "100%",
              overflow: "visible",
            }}
            codeTagProps={{
              style: {
                fontFamily: "var(--font-mono)",
                fontSize: appearance.codeFontSize,
                overflowWrap: (wrapLines || appearance.wrapCodeLines) ? "anywhere" : "normal",
              },
            }}
            renderer={(rendererProps) => (
              <SourceCodeRenderer
                {...rendererProps}
                wrapLines={wrapLines || appearance.wrapCodeLines}
                diagnosticsByLine={diagnosticsByLine}
              />
            )}
            wrapLongLines={wrapLines || appearance.wrapCodeLines}
          >
            {data.content}
          </SyntaxHighlighter>
        )}
      </div>

      {diagPanelOpen && diagList.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: 160,
            overflow: "auto",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
          }}
        >
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 10px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-subtle)",
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Diagnostics
            <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>{diagList.length}</span>
            <button
              type="button"
              className="chrome-btn"
              onClick={() => setDiagPanelOpen(false)}
              style={{ marginLeft: "auto", height: 20, minHeight: 20, padding: "0 6px", fontSize: 10 }}
            >
              Hide
            </button>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {diagList.map((d, i) => (
              <li key={`${d.line}-${d.severity}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    setDisplayMode("source");
                    // Scroll to line if present
                    requestAnimationFrame(() => {
                      const el = contentRef.current?.querySelector(`[data-line-number="${d.line}"]`);
                      if (el instanceof HTMLElement) {
                        el.scrollIntoView({ block: "center", behavior: "smooth" });
                      }
                    });
                  }}
                  style={{
                    display: "flex",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
                    background: "transparent",
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 600,
                      color: d.severity === "error"
                        ? "var(--destructive)"
                        : d.severity === "warning"
                          ? "var(--text)"
                          : "var(--text-muted)",
                      minWidth: 52,
                    }}
                  >
                    {d.severity.toUpperCase()}
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                    L{d.line}{d.column != null ? `:${d.column}` : ""}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, lineHeight: 1.35 }}>
                    {d.code ? `[${d.code}] ` : ""}{d.message}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  );
}
