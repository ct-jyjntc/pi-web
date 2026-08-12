/**
 * Parse pi-subagents TUI widget lines into structured agent rows for chrome UI.
 */
import { stripAnsi } from "./ansi";

export type AgentItemStatus =
  | "running"
  | "queued"
  | "completed"
  | "error"
  | "stopped"
  | "aborted"
  | "unknown";

export type AgentItem = {
  status: AgentItemStatus;
  type?: string;
  description: string;
  activity?: string;
  detail?: string;
  queuedCount?: number;
};

const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const TREE_RE = /^[├└─\s]+/;

function stripTree(line: string): string {
  return line.replace(TREE_RE, "").trim();
}

function isActivityLine(trimmed: string, raw: string): boolean {
  if (/^[│|]/.test(trimmed)) return true;
  if (/^⎿/.test(trimmed) || /^\s+⎿/.test(raw)) return true;
  return false;
}

function stripActivityPrefix(line: string): string {
  return line.replace(/^[│|\s]+/, "").replace(/^⎿\s*/, "").trim();
}

function statusFromGlyph(head: string): { status: AgentItemStatus; rest: string } {
  const trimmed = head.trim();
  if (!trimmed) return { status: "unknown", rest: "" };
  if (SPINNER_RE.test(trimmed[0]!) || SPINNER_RE.test(trimmed.slice(0, 2))) {
    return { status: "running", rest: trimmed.replace(SPINNER_RE, "").trim() };
  }
  if (/^[✓✔√]/.test(trimmed)) return { status: "completed", rest: trimmed.replace(/^[✓✔√]\s*/, "") };
  if (/^[✗⊘]/.test(trimmed)) return { status: "error", rest: trimmed.replace(/^[✗⊘]\s*/, "") };
  if (/^■/.test(trimmed)) return { status: "stopped", rest: trimmed.replace(/^■\s*/, "") };
  if (/^◦/.test(trimmed)) return { status: "queued", rest: trimmed.replace(/^◦\s*/, "") };
  if (/^●/.test(trimmed)) return { status: "running", rest: trimmed.replace(/^●\s*/, "") };
  return { status: "unknown", rest: trimmed };
}

function applyStatusSuffix(status: AgentItemStatus, rest: string): AgentItemStatus {
  if (/\baborted\b/i.test(rest)) return "aborted";
  if (/\bstopped\b/i.test(rest)) return "stopped";
  if (/\berror\b/i.test(rest)) return status === "unknown" ? "error" : status;
  return status;
}

function splitTypeAndDescription(head: string): { type?: string; description: string } {
  const twoSpace = head.match(/^(\S+)(?:\s+\(([^)]+)\))?\s{2,}(.+)$/);
  if (twoSpace) {
    return { type: twoSpace[1], description: twoSpace[3]!.trim() };
  }
  const oneSpace = head.match(/^(\S+)\s+(.+)$/);
  if (oneSpace) return { type: oneSpace[1], description: oneSpace[2]!.trim() };
  return { description: head.trim() };
}

export function parseAgentHeader(line: string): AgentItem | null {
  const raw = stripTree(stripAnsi(line));
  if (!raw) return null;
  if (/^\+\d+\s+more\b/i.test(raw)) return null;

  const queued = raw.match(/(\d+)\s+queued\b/i);
  if (queued) {
    const n = Number(queued[1]);
    return {
      status: "queued",
      description: `${n} queued`,
      queuedCount: Number.isFinite(n) ? n : 1,
    };
  }

  const { status: glyphStatus, rest } = statusFromGlyph(raw);
  if (!rest) return null;
  const status = applyStatusSuffix(glyphStatus, rest);
  const [head, ...statParts] = rest.split(/\s+·\s+/);
  const detail = statParts
    .join(" · ")
    .replace(/\s+(\(turn limit\)|error(?::\s*.*)?|stopped|aborted)\s*$/i, "")
    .trim();
  const { type, description } = splitTypeAndDescription((head ?? "").trim());
  if (!description && !type) return null;
  return {
    status,
    type,
    description: description || type || raw,
    detail: detail || undefined,
  };
}

/** Turn stripped widget body lines into one row per agent. */
export function parseAgentItems(lines: readonly string[]): AgentItem[] {
  const items: AgentItem[] = [];
  let current: AgentItem | null = null;
  const body = lines.slice(1);
  for (const rawLine of body) {
    const raw = stripAnsi(rawLine).replace(/\s+$/, "");
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isActivityLine(trimmed, raw)) {
      const activity = stripActivityPrefix(trimmed);
      if (current && activity) current.activity = activity;
      continue;
    }
    const item = parseAgentHeader(trimmed);
    if (!item) {
      current = null;
      continue;
    }
    items.push(item);
    current = item.status === "running" ? item : null;
  }
  return items;
}

export function agentListCounts(items: readonly AgentItem[]): {
  agentCount: number;
  runningCount: number;
  queuedCount: number;
} {
  let runningCount = 0;
  let queuedCount = 0;
  let agentCount = 0;
  for (const item of items) {
    if (item.status === "running") runningCount += 1;
    if (item.status === "queued") queuedCount += item.queuedCount ?? 1;
    agentCount += item.queuedCount ?? 1;
  }
  return { agentCount, runningCount, queuedCount };
}
