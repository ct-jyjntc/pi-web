/**
 * Expanded todo / subagent menu for the top-bar capsules.
 * Compact GPT-style card; inline-styled so layout survives CSS HMR.
 */
"use client";

import type { CSSProperties, Ref } from "react";
import { useLocale } from "@/hooks/useLocale";
import {
  parseWidget,
  type ParsedAgentsWidget,
  type ParsedTodoWidget,
} from "@/lib/extension-widgets";
import type { ExtensionWidgetItem } from "@/lib/types";
import { AgentCatalogTree } from "./AgentCatalogTree";
import { TodoItemRow } from "./TodoAtoms";

export const CHROME_WIDGET_POPOVER_WIDTH = 280;
export const AGENTS_POPOVER_WIDTH = 336;
 
 const EMPTY: CSSProperties = {
   padding: "8px 10px",
   fontSize: 12,
   color: "var(--text-dim)",
 };

function TodoBody({ parsed }: { parsed: ParsedTodoWidget }) {
  const { t } = useLocale();
  if (parsed.collapsedHint) return <div style={EMPTY}>{parsed.collapsedHint}</div>;
  if (parsed.items.length === 0) return <div style={EMPTY}>{t("ext.todoEmpty")}</div>;
  return (
     <div style={{ padding: "0 2px 4px" }}>
      {parsed.items.map((item, i) => (
        <TodoItemRow key={`${item.id ?? i}-${item.text.slice(0, 24)}`} item={item} />
      ))}
    </div>
  );
}

function AgentsBody({
  parsed,
  parentSessionId,
}: {
  parsed: ParsedAgentsWidget;
  parentSessionId?: string | null;
}) {
  const { t } = useLocale();
  if (parsed.items.length === 0) return <div style={EMPTY}>{t("ext.agentsEmpty")}</div>;
  return <AgentCatalogTree items={parsed.items} parentSessionId={parentSessionId} />;
}

export function ChromeWidgetPopover({
  widget,
  pos,
  popoverRef,
  parentSessionId,
}: {
  widget: ExtensionWidgetItem;
  pos: { top: number; left: number };
  popoverRef: Ref<HTMLDivElement>;
  parentSessionId?: string | null;
}) {
  const { t } = useLocale();
  const parsed = parseWidget(widget.key, widget.lines);
  const isTodo = parsed.kind === "todo";
  const title = isTodo ? t("ext.todo") : t("ext.agents");

  let count = "";
  if (parsed.kind === "todo" && parsed.total > 0) {
    count = `${parsed.completed} / ${parsed.total}`;
  } else if (parsed.kind === "agents") {
    count = String(Math.max(0, parsed.agentCount));
  }

  const agents = parsed.kind === "agents";
  return (
    <div
      ref={popoverRef}
      className="menu-card"
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        display: "flex",
        flexDirection: "column",
        width: agents ? AGENTS_POPOVER_WIDTH : CHROME_WIDGET_POPOVER_WIDTH,
        maxHeight: agents ? "min(560px, calc(100vh - 140px))" : "min(42vh, 300px)",
        overflow: "hidden",
        zIndex: 520,
        borderRadius: "var(--radius-md)",
        padding: agents ? 4 : 3,
      }}
    >
      {agents ? null : (
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "baseline",
           gap: 8,
           padding: "4px 8px 2px",
        }}
      >
        <span
          style={{
             fontSize: 12,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          {title}
        </span>
        {count ? (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              color: "var(--text-dim)",
            }}
          >
            {count}
          </span>
        ) : null}
      </div>
      )}
      <div style={{ overflowY: "auto", minHeight: 0 }}>
        {parsed.kind === "todo" ? (
          <TodoBody parsed={parsed} />
        ) : parsed.kind === "agents" ? (
          <AgentsBody parsed={parsed} parentSessionId={parentSessionId} />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.4,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
            }}
          >
            {widget.lines.join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
