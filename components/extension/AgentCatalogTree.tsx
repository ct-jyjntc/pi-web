/**
 * Nested subagent catalog from pre-order widget items (depth + parentId).
 */
"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AgentItem } from "@/lib/extension-widget-agents";
import { AgentItemRow } from "./AgentAtoms";
import { Icon } from "../Icon";

type CatalogNode = {
  item: AgentItem;
  children: CatalogNode[];
};

export function buildAgentCatalogTree(items: AgentItem[]): CatalogNode[] {
  const roots: CatalogNode[] = [];
  const stack: CatalogNode[] = [];
  for (const item of items) {
    const depth = item.depth ?? 1;
    const node: CatalogNode = { item, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1]!.item.depth ?? 1) >= depth) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return roots;
}

function CatalogNodeView({
  node,
  rootParentSessionId,
}: {
  node: CatalogNode;
  rootParentSessionId?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const depth = node.item.depth ?? 1;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {hasChildren ? (
          <button
            type="button"
            className="chrome-btn is-icon"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            style={{
              width: 18,
              minWidth: 18,
              height: 18,
              marginTop: 11,
              marginLeft: (depth - 1) * 12,
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
            }}
          >
            <Icon
              icon={ChevronRight}
              size={12}
              strokeWidth={1.8}
              style={{ transform: open ? "rotate(90deg)" : undefined }}
            />
          </button>
        ) : (
          <span style={{ width: 18, marginLeft: (depth - 1) * 12, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <AgentItemRow
            item={node.item}
            parentSessionId={node.item.parentId || rootParentSessionId}
          />
        </div>
      </div>
      {hasChildren && open ? (
        <div>
          {node.children.map((child, index) => (
            <CatalogNodeView
              key={`${child.item.sessionId ?? child.item.description}-${index}`}
              node={child}
              rootParentSessionId={rootParentSessionId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AgentCatalogTree({
  items,
  parentSessionId,
}: {
  items: AgentItem[];
  parentSessionId?: string | null;
}) {
  const roots = useMemo(() => buildAgentCatalogTree(items), [items]);
  return (
    <div style={{ padding: "0 2px 4px" }}>
      {roots.map((node, index) => (
        <CatalogNodeView
          key={`${node.item.sessionId ?? node.item.description}-${index}`}
          node={node}
          rootParentSessionId={parentSessionId}
        />
      ))}
    </div>
  );
}
