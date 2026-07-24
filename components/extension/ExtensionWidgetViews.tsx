"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import {
  parseWidget,
  widgetTitle,
  type ParsedTodoWidget,
  type ParsedAgentsWidget,
  type ParsedGenericWidget,
  type TodoItem,
} from "@/lib/extension-widgets";

const COLLAPSE_KEY = "pi-web-ext-widget-open";

function useOpenMap() {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setOpen(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore
    }
  }, []);

  const setKeyOpen = (key: string, value: boolean) => {
    setOpen((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return { open, setKeyOpen };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="var(--text-dim)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s", flexShrink: 0 }}
    >
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );
}

function TodoDot({ status }: { status: TodoItem["status"] }) {
  const color =
    status === "completed" ? "var(--success)"
      : status === "in_progress" ? "var(--accent)"
        : "var(--text-dim)";
  const symbol =
    status === "completed" ? "✓"
      : status === "in_progress" ? "●"
        : "○";
  return (
    <span style={{ color, width: 12, flexShrink: 0, fontSize: 11, lineHeight: "16px", textAlign: "center" }}>
      {symbol}
    </span>
  );
}

function CompactShell({
  widgetKey,
  title,
  summary,
  accent,
  children,
  defaultOpen = false,
}: {
  widgetKey: string;
  title: string;
  summary: React.ReactNode;
  accent: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { open, setKeyOpen } = useOpenMap();
  const isOpen = open[widgetKey] ?? defaultOpen;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-panel)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setKeyOpen(widgetKey, !isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: 30,
          padding: "4px 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text)",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 99, background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 650, flexShrink: 0 }}>{title}</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <Chevron open={isOpen} />
      </button>
      {isOpen && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            maxHeight: 140,
            overflowY: "auto",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function TodoWidgetCard({ parsed, widgetKey }: { parsed: ParsedTodoWidget; widgetKey: string }) {
  const { t } = useLocale();
  const pct = parsed.total > 0 ? Math.round((parsed.completed / parsed.total) * 100) : 0;
  const active = parsed.items.find((i) => i.status === "in_progress");
  const summary = parsed.collapsedHint
    ? parsed.collapsedHint
    : active
      ? `${parsed.completed}/${parsed.total} · ${active.text}`
      : `${parsed.completed}/${parsed.total}`;

  return (
    <CompactShell
      widgetKey={widgetKey}
      title={t("ext.todo")}
      accent={pct >= 100 ? "var(--success)" : "var(--accent)"}
      summary={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
          <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{summary}</span>
          {parsed.total > 0 && (
            <span
              style={{
                width: 48,
                height: 3,
                borderRadius: 99,
                background: "var(--border)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${pct}%`,
                  height: "100%",
                  background: pct >= 100 ? "var(--success)" : "var(--accent)",
                }}
              />
            </span>
          )}
        </span>
      }
    >
      {parsed.collapsedHint ? (
        <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)" }}>
          {parsed.collapsedHint}
        </div>
      ) : parsed.items.length === 0 ? (
        <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("ext.todoEmpty")}</div>
      ) : (
        <div style={{ padding: "4px 6px 6px" }}>
          {parsed.items.map((item, i) => (
            <div
              key={`${item.id ?? i}-${item.text.slice(0, 24)}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                padding: "3px 6px",
              }}
            >
              <TodoDot status={item.status} />
              <div
                style={{
                  minWidth: 0,
                  flex: 1,
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: item.status === "completed" ? "var(--text-dim)" : "var(--text)",
                  textDecoration: item.status === "completed" ? "line-through" : "none",
                }}
              >
                {item.id ? (
                  <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, marginRight: 4 }}>
                    #{item.id}
                  </span>
                ) : null}
                {item.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </CompactShell>
  );
}

function AgentsWidgetCard({ parsed, widgetKey }: { parsed: ParsedAgentsWidget; widgetKey: string }) {
  const { t } = useLocale();
  const body = parsed.lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
  const summary = body || parsed.heading;

  return (
    <CompactShell
      widgetKey={widgetKey}
      title={t("ext.agents")}
      accent="var(--success)"
      summary={summary}
    >
      <pre
        style={{
          margin: 0,
          padding: "6px 10px",
          fontSize: 11,
          lineHeight: 1.4,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {parsed.lines.join("\n")}
      </pre>
    </CompactShell>
  );
}

function GenericWidgetCard({ parsed, widgetKey }: { parsed: ParsedGenericWidget; widgetKey: string }) {
  const accent =
    parsed.kind === "permission" ? "var(--destructive)"
      : parsed.kind === "btw" ? "var(--accent)"
        : "var(--text-dim)";
  const summary = parsed.lines.join(" ").replace(/\s+/g, " ").trim();

  return (
    <CompactShell
      widgetKey={widgetKey}
      title={widgetTitle(widgetKey)}
      accent={accent}
      summary={summary}
    >
      <pre
        style={{
          margin: 0,
          padding: "6px 10px",
          fontSize: 11,
          lineHeight: 1.4,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {parsed.lines.join("\n")}
      </pre>
    </CompactShell>
  );
}

export function SpecializedExtensionWidget({
  widgetKey,
  lines,
}: {
  widgetKey: string;
  lines: string[];
}) {
  const parsed = parseWidget(widgetKey, lines);
  if (parsed.kind === "todo") return <TodoWidgetCard parsed={parsed} widgetKey={widgetKey} />;
  if (parsed.kind === "agents") return <AgentsWidgetCard parsed={parsed} widgetKey={widgetKey} />;
  return <GenericWidgetCard parsed={parsed} widgetKey={widgetKey} />;
}

export function SpecializedStatusChip({
  statusKey,
  text,
}: {
  statusKey: string;
  text: string;
}) {
  const kind = statusKey.toLowerCase();
  const isYolo = /yolo/i.test(text);
  const isPermission = kind.includes("permission") || kind.includes("pi-permission");
  const isAgents = kind.includes("subagent") || kind === "agents";

  const label =
    isPermission ? "Permission"
      : isAgents ? "Agents"
        : kind.includes("todo") ? "Todo"
          : kind.includes("btw") ? "BTW"
            : kind.includes("rtk") ? "RTK"
              : statusKey;

  const color =
    isYolo ? "var(--destructive)"
      : isPermission ? "var(--accent)"
        : isAgents ? "var(--success)"
          : "var(--text-dim)";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid color-mix(in oklab, ${color} 24%, var(--border))`,
        background: `color-mix(in oklab, ${color} 7%, var(--bg-panel))`,
        color: "var(--text-muted)",
        fontSize: 11,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 99, background: color, flexShrink: 0 }} />
      <span style={{ color: "var(--text)", fontWeight: 650, fontSize: 10 }}>{label}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {text}
      </span>
    </div>
  );
}
