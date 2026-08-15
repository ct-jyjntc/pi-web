/**
 * Render native subagent rows as the TUI lines chrome already parses.
 */
import type { SubagentRecord } from "./types";

const GLYPH: Record<SubagentRecord["status"], string> = {
  running: "⠋",
  queued: "◦",
  completed: "✓",
  error: "✗",
  stopped: "■",
  aborted: "■",
};

function elapsed(record: SubagentRecord): string {
  const end = record.completedAt ?? Date.now();
  const ms = Math.max(0, end - record.startedAt);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokensK(tokens: number): string {
  const k = tokens / 1000;
  if (k >= 10) return `${Math.round(k)}k`;
  return `${Math.max(0, k).toFixed(1)}k`;
}

function stats(record: SubagentRecord): string {
  const parts: string[] = [];
  if (typeof record.contextTokens === "number" && Number.isFinite(record.contextTokens)) {
    parts.push(formatTokensK(record.contextTokens));
  }
  if (typeof record.contextPercent === "number" && Number.isFinite(record.contextPercent)) {
    parts.push(`${Math.round(record.contextPercent)}%`);
  }
  if (record.status === "running") parts.push(`@${record.startedAt}`);
  else parts.push(elapsed(record));
  if (record.sessionId) parts.push(`sid:${record.sessionId}`);
  if (record.mode === "continuable" || record.mode === "one-shot") {
    parts.push(`mode:${record.mode}`);
  }
  const depth = record.depth ?? 1;
  if (depth > 1) parts.push(`depth:${depth}`);
  if (record.parentSessionId) parts.push(`parent:${record.parentSessionId}`);
  if (record.summary) {
    parts.push(`about:${record.summary.replace(/\s+/g, " ").replace(/ · /g, " ").slice(0, 120)}`);
  }
  return parts.join(" · ");
}

function isLastSibling(records: readonly SubagentRecord[], index: number): boolean {
  const depth = records[index]?.depth ?? 1;
  for (let i = index + 1; i < records.length; i += 1) {
    const next = records[i]!.depth ?? 1;
    if (next < depth) return true;
    if (next === depth) return false;
  }
  return true;
}

export function formatAgentWidgetLines(records: readonly SubagentRecord[]): string[] | undefined {
  if (records.length === 0) return undefined;

  const live = records.filter((record) => record.status === "running" || record.status === "queued");
  const lines = [live.some((record) => record.status === "running") ? "● Agents" : "○ Agents"];
  records.forEach((record, index) => {
    const depth = Math.max(1, record.depth ?? 1);
    const last = isLastSibling(records, index);
    const pad = "│  ".repeat(depth - 1);
    const branch = last ? "└─" : "├─";
    const glyph = GLYPH[record.status];
    lines.push(`${pad}${branch} ${glyph} ${record.displayName}  ${record.description} · ${stats(record)}`);
    if (record.activity) {
      const actPad = pad + (last ? "   " : "│  ");
      lines.push(`${actPad}⎿  ${record.activity}`);
    }
  });
  return lines;
}
