/** Parse and classify extension widget/status content for specialized UI. */

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

export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, "").replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "");
}

export interface TodoItem {
  status: "pending" | "in_progress" | "completed" | "unknown";
  text: string;
  id?: string;
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
      items.push({ status: parseTodoStatus(t), text, id });
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
    return {
      kind: "agents",
      heading: clean[0]?.trim() || "Agents",
      lines: clean,
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
