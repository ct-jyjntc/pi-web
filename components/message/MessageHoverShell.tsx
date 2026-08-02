"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/**
 * Wrapper that owns the hover/focus state used to reveal a message's action row.
 * The message body is passed as `children`, so its element identity stays stable
 * across hover updates and React bails out of re-rendering that subtree — a
 * mouseenter no longer rebuilds thousands of diff rows below.
 */
export function MessageHoverShell({ style, renderActions, children }: {
  style: CSSProperties;
  renderActions: (active: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);

  return (
    <div
      style={style}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        // React onBlur is focusout: ignore focus moves between our own children.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setActive(false);
      }}
    >
      {children}
      {renderActions(active)}
    </div>
  );
}

