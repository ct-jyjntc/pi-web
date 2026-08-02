"use client";

import { useCallback, useState, memo } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionTreeNode } from "./session-sidebar-helpers";
import { SessionItem } from "./SessionItem";

export const SessionTreeItem = memo(function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: (sessionId?: string, name?: string) => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const session = node.session;

  // Stable identities so the memoized row only re-renders on real prop changes.
  const handleClick = useCallback(() => onSelectSession(session), [onSelectSession, session]);
  const handleToggleCollapse = useCallback(() => setCollapsed((v) => !v), []);

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: 22 + (depth - 1) * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={session}
          isSelected={session.id === selectedSessionId}
          isRunning={runningSessionIds.has(session.id)}
          isUnread={unreadSessionIds.has(session.id)}
          onClick={handleClick}
          onRenamed={onRenamed}
          onDeleted={onSessionDeleted}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});


