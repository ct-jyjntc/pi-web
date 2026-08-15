/** Parse and classify extension widget/status content for specialized UI. */
import { stripAnsi } from "./ansi";
import {
  agentListCounts,
  parseAgentItems,
  type AgentItem,
} from "./extension-widget-agents";

export type { AgentItem, AgentItemStatus } from "./extension-widget-agents";

export type WidgetKind =
  | "todo"
  | "agents"
  | "permission"
  | "btw"
  | "compaction"
  | "rtk"
  | "generic";

export function classifyWidgetKey(key: string): WidgetKind {
  const k = key.toLowerCase();
  if (k.includes("todo") || k === "rpiv-todos") return "todo";
  if (k === "agents" || k.includes("subagent")) return "agents";
  if (k.includes("permission") || k.includes("policy") || k.includes("pi-permission")) return "permission";
  if (k === "btw" || k.includes("btw")) return "btw";
  if (k.includes("compact")) return "compaction";
  if (k.includes("rtk") || k.includes("token")) return "rtk";
  return "generic";
}

export interface TodoItem {
  status: "pending" | "in_progress" | "completed" | "unknown";
  text: string;
  id?: string;
  /** Present-continuous label while in_progress, when the line encodes it. */
  activeForm?: string;
}

export interface ParsedTodoWidget {
  kind: "todo";
  heading: string;
  completed: number;
  total: number;
  items: TodoItem[];
  collapsedHint?: string;
}

export interface ParsedAgentsWidget {
  kind: "agents";
  heading: string;
  lines: string[];
  /** Distinct agent rows (not raw line count — running agents take 2 lines). */
  agentCount: number;
  items: AgentItem[];
  runningCount: number;
  queuedCount: number;
}

export interface ParsedGenericWidget {
  kind: "generic" | "permission" | "btw" | "compaction" | "rtk";
  title: string;
  lines: string[];
}

export type ParsedWidget = ParsedTodoWidget | ParsedAgentsWidget | ParsedGenericWidget;

function parseTodoStatus(raw: string): TodoItem["status"] {
  // rpiv-todo: pending ○, in_progress ◐, completed ✓ (alt icon style: ●)
  if (/[✓✔√●]/.test(raw) || /\bcompleted\b/i.test(raw) || raw.includes("[x]") || raw.includes("[X]")) {
    return "completed";
  }
  if (/[◐▸▶►]/.test(raw) || /\bin[_ ]?progress\b/i.test(raw) || raw.includes("[~]")) {
    return "in_progress";
  }
  if (/[○◯□☐]/.test(raw) || /\bpending\b/i.test(raw) || raw.includes("[ ]")) {
    return "pending";
  }
  return "unknown";
}

/** rpiv-todo deleted tasks (✗ / ⊘) are removed from the list, not shown as items. */
function isDeletedTodo(raw: string): boolean {
  return /[✗⊘]/.test(raw) || /\bdeleted\b/i.test(raw);
}

/**
 * Progress counts in the heading. The rpiv-todo format is parenthesized
 * ("Todo (2/5)") and always trusted. A bare "n/m" is only accepted when it
 * matches the parsed item count, so dates like "10/28" in a title are not
 * mistaken for progress.
 */
function parseHeadingCounts(heading: string, itemCount: number): { completed: number; total: number } | null {
  const paren = heading.match(/\((\d+)\s*\/\s*(\d+)\)/);
  if (paren) return { completed: Number(paren[1]), total: Number(paren[2]) };
  const bare = heading.match(/(\d+)\s*\/\s*(\d+)/);
  if (bare && (itemCount === 0 || Number(bare[2]) === itemCount)) {
    return { completed: Number(bare[1]), total: Number(bare[2]) };
  }
  return null;
}

export function parseWidget(key: string, lines: string[]): ParsedWidget {
  const kind = classifyWidgetKey(key);
  const clean = lines.map((l) => stripAnsi(l)).filter((l) => l.trim().length > 0 || l === "");

  if (kind === "todo") {
    const heading = clean[0]?.trim() || "Todo";
    const items: TodoItem[] = [];
    for (const line of clean.slice(1)) {
      const t = line.trim();
      if (!t) continue;
      // Strip checkbox marks, overlay tree connectors ("├─"/"└─") and any
      // repeated status-glyph runs, plus trailing decoration dashes.
      let s = t.replace(/^\[[ xX~\-]?\]\s*/, "");
      for (let i = 0; i < 4; i++) {
        const next = s.replace(/^[○◯□☐◐●▸▶►✓✔√✗⊘~\-•*─━├└╰│┌┐]+\s*/, "");
        if (next === s) break;
        s = next;
      }
      s = s.replace(/[\s─━]+$/, "").trim();
      if (!s) continue;
      if (items.length === 0 && clean.length <= 2 && (/collapsed/i.test(s) || (/ctrl/i.test(s) && /expand/i.test(s)))) {
        const counts = parseHeadingCounts(heading, 0);
        return {
          kind: "todo",
          heading,
          completed: counts?.completed ?? 0,
          total: counts?.total ?? 0,
          items: [],
          collapsedHint: s,
        };
      }
      if (isDeletedTodo(t)) continue;
      // "+3 more (…)" overflow summary row — not a task.
      if (/^\+\d+/.test(s)) continue;
      // "── Pending ──" section headers (from /todos output) — not a task.
      if (/^(pending|in[ _]?progress|completed)$/i.test(s)) continue;
      // Common formats: "#1 do thing" / "1. do thing" / "✓ done"
      const idMatch = s.match(/^#(\d+)\s+(.+)$/) || s.match(/#?(\d+)[.:)]\s*(.+)$/) || s.match(/^([○◯□☐◐●▸▶►✓✔√])\s+#?(\d+)?\s*(.+)$/);
      let text = s;
      let id: string | undefined;
      if (idMatch) {
        if (idMatch.length === 3 && /^\d+$/.test(idMatch[1])) {
          id = idMatch[1];
          text = idMatch[2];
        } else if (idMatch.length >= 4) {
          id = idMatch[2] || undefined;
          text = idMatch[3] || idMatch[2] || s;
        }
      }
      text = text.trim() || s || t;
      const status = parseTodoStatus(t);
      let activeForm: string | undefined;
      if (status === "in_progress") {
        const encoded = text.match(/^(.*?)\s+\(([^)]+)\)\s*$/);
        if (encoded) {
          text = encoded[1]!.trim() || text;
          activeForm = encoded[2]!.trim() || undefined;
        }
      }
      items.push({ status, text, id, activeForm });
    }
    const counts = parseHeadingCounts(heading, items.length);
    return {
      kind: "todo",
      heading,
      completed: counts?.completed ?? items.filter((i) => i.status === "completed").length,
      total: counts?.total ?? items.length,
      items,
    };
  }

  if (kind === "agents") {
    const heading = clean[0]?.trim() || "Agents";
    const items = parseAgentItems(clean);
    const counts = agentListCounts(items);
    return {
      kind: "agents",
      heading,
      lines: clean,
      items,
      agentCount: counts.agentCount > 0 ? counts.agentCount : countAgentsFromWidgetLines(clean),
      runningCount: counts.runningCount,
      queuedCount: counts.queuedCount,
    };
  }

  const titles: Record<string, string> = {
    permission: "Permission",
    btw: "Side chat",
    compaction: "Compaction",
    rtk: "Token optimizer",
    generic: key,
  };

  return {
    kind,
    title: titles[kind] ?? key,
    lines: clean,
  };
}

export function widgetTitle(key: string): string {
  const kind = classifyWidgetKey(key);
  switch (kind) {
    case "todo": return "Todo";
    case "agents": return "Subagents";
    case "permission": return "Permission";
    case "btw": return "Side chat";
    case "compaction": return "Compaction";
    case "rtk": return "Tokens";
    default: return key;
  }
}

/**
 * Count distinct agents in a pi-subagents widget body.
 *
 * Running agents render as a pair (header + activity continuation); finished
 * agents are one tree line. Counting raw body lines therefore doubles running
 * agents (2 agents → "4"). We count tree headers only.
 */
export function countAgentsFromWidgetLines(lines: string[]): number {
  if (lines.length === 0) return 0;
  const body = lines.slice(1).map((l) => stripAnsi(l));
  // Prefer explicit "N running" / "N agents" in the heading or a status line.
  const joined = [stripAnsi(lines[0] ?? ""), ...body].join("\n");
  const runningMatch = joined.match(/(\d+)\s+running/i);
  const queuedMatch = joined.match(/(\d+)\s+queued/i);
  if (runningMatch || queuedMatch) {
    return (runningMatch ? Number(runningMatch[1]) : 0) + (queuedMatch ? Number(queuedMatch[1]) : 0);
  }

  let count = 0;
  for (const raw of body) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    // Activity continuation under a running agent:
    //   "│  ⎿ …"  or  "   ⎿ …"  (sub-line glyph U+23BF, not a tree node)
    if (/^[│|]/.test(trimmed)) continue;
    if (/^⎿/.test(trimmed) || /^\s+⎿/.test(line)) continue;
    // Overflow summary: "+2 more (…)"
    if (/^\+\d+\s+more\b/i.test(trimmed.replace(/^[├└─\s]+/, ""))) continue;
    // Queued aggregate is one row for many agents — count the number if present.
    const queuedRow = trimmed.match(/(\d+)\s+queued\b/i);
    if (queuedRow && /[├└]/.test(trimmed)) {
      count += Number(queuedRow[1]);
      continue;
    }
    // Tree header for one agent: "├─ …" / "└─ …" (box-drawing branch)
    if (/^[├└]/.test(trimmed)) {
      count += 1;
      continue;
    }
  }
  return count;
}

/** True when a todo widget payload has something worth showing in the top bar. */
export function todoWidgetHasContent(lines: string[]): boolean {
  const parsed = parseWidget("rpiv-todos", lines);
  if (parsed.kind !== "todo") return false;
  if (parsed.collapsedHint) return true;
  if (parsed.total > 0 || parsed.items.length > 0) return true;
  // Heading alone with (n/m) still counts.
  return /\(\d+\s*\/\s*\d+\)/.test(parsed.heading);
}

function todoFocusText(item: TodoItem): string {
  return item.activeForm?.trim() || item.text;
}

/** Current work label for the capsule (no count). */
export function chromeWidgetFocus(key: string, lines: string[]): string {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "todo") {
    const active = parsed.items.find((i) => i.status === "in_progress");
    if (active) return todoFocusText(active);
    const pending = parsed.items.find((i) => i.status === "pending");
    return pending?.text ?? "";
  }
  if (parsed.kind === "agents") {
    const running = parsed.items.find((i) => i.status === "running");
    if (running) return running.description;
    const queued = parsed.items.find((i) => i.status === "queued");
    return queued?.description ?? parsed.items[0]?.description ?? "";
  }
  return "";
}

/** Hide the capsule when nothing is in flight. Completed agents stay visible so they can be opened. */
export function chromeWidgetIsIdle(key: string, lines: string[]): boolean {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "todo") {
    if (parsed.collapsedHint) return parsed.completed >= parsed.total && parsed.total > 0;
    return !parsed.items.some((i) => i.status === "in_progress" || i.status === "pending");
  }
  if (parsed.kind === "agents") {
    return parsed.items.length === 0;
  }
  return false;
}

/** One-line top-bar summary for a chrome widget (todo / agents). */
export function chromeWidgetSummary(key: string, lines: string[]): string {
  const parsed = parseWidget(key, lines);
  if (parsed.kind === "todo") {
    if (parsed.collapsedHint) return parsed.collapsedHint;
    const focus = chromeWidgetFocus(key, lines);
    if (parsed.total > 0 && focus) return `${parsed.completed}/${parsed.total} · ${focus}`;
    if (parsed.total > 0) return `${parsed.completed}/${parsed.total}`;
    return focus;
  }
  if (parsed.kind === "agents") {
    const n = parsed.agentCount;
    const focus = chromeWidgetFocus(key, lines);
    if (n <= 0) return parsed.heading;
    if (focus) return n > 1 ? `${n} · ${focus}` : focus;
    return `${n} agent${n === 1 ? "" : "s"}`;
  }
  return parsed.lines.join(" ").replace(/\s+/g, " ").trim();
}

export function isChromeTopBarWidgetKey(key: string): boolean {
  const kind = classifyWidgetKey(key);
  return kind === "todo" || kind === "agents";
}
