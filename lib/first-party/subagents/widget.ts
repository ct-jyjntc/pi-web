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
  return parts.join(" · ");
}

export function formatAgentWidgetLines(records: readonly SubagentRecord[]): string[] | undefined {
  const live = records.filter((record) => record.status === "running" || record.status === "queued");
  if (live.length === 0) return undefined;

  const lines = [live.some((record) => record.status === "running") ? "● Agents" : "○ Agents"];
  const visible = records.filter((record) => record.status !== "completed" || live.length > 0);
  visible.forEach((record, index) => {
    const last = index === visible.length - 1;
    const branch = last ? "└─" : "├─";
    const glyph = GLYPH[record.status];
    lines.push(`${branch} ${glyph} ${record.displayName}  ${record.description} · ${stats(record)}`);
    if (record.status === "running" && record.activity) {
      lines.push(`│  ⎿  ${record.activity}`);
    }
  });
  return lines;
}
