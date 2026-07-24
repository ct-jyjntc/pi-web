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
  if (/[✓✔√]/.test(raw) || /\bcompleted\b/i.test(raw) || raw.includes("[x]") || raw.includes("[X]")) {
    return "completed";
  }
  if (/[◐●▸▶►]/.test(raw) || /\bin[_ ]?progress\b/i.test(raw) || raw.includes("[~]")) {
    return "in_progress";
  }
  if (/[○◯□☐]/.test(raw) || /\bpending\b/i.test(raw) || raw.includes("[ ]")) {
    return "pending";
  }
  return "unknown";
}

export function parseWidget(key: string, lines: string[]): ParsedWidget {
  const kind = classifyWidgetKey(key);
  const clean = lines.map((l) => stripAnsi(l)).filter((l) => l.trim().length > 0 || l === "");

  if (kind === "todo") {
    const heading = clean[0]?.trim() || "Todo";
    const countMatch = heading.match(/(\d+)\s*\/\s*(\d+)/);
    const items: TodoItem[] = [];
    for (const line of clean.slice(1)) {
      const t = line.trim();
      if (!t) continue;
      if (/collapsed|expand|ctrl/i.test(t) && items.length === 0 && clean.length <= 2) {
        return {
          kind: "todo",
          heading,
          completed: countMatch ? Number(countMatch[1]) : 0,
          total: countMatch ? Number(countMatch[2]) : 0,
          items: [],
          collapsedHint: t,
        };
      }
      // Common formats: "○ 1. do thing" / "[ ] task" / "✓ done"
      const idMatch = t.match(/#?(\d+)[.:)]\s*(.+)$/) || t.match(/^([○◯□☐◐●▸▶►✓✔√xX])\s+#?(\d+)?\s*(.+)$/);
      let text = t;
      let id: string | undefined;
      if (idMatch) {
        if (idMatch.length === 3 && /^\d+$/.test(idMatch[1])) {
          id = idMatch[1];
          text = idMatch[2];
        } else if (idMatch.length >= 4) {
          id = idMatch[2] || undefined;
          text = idMatch[3] || idMatch[2] || t;
        }
      }
      text = text.replace(/^[○◯□☐◐●▸▶►✓✔√\[\] xX~\-•*]+\s*/, "").trim() || t;
      items.push({ status: parseTodoStatus(t), text, id });
    }
    return {
      kind: "todo",
      heading,
      completed: countMatch ? Number(countMatch[1]) : items.filter((i) => i.status === "completed").length,
      total: countMatch ? Number(countMatch[2]) : items.length,
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
