"use client";

import { useEffect, useRef, useState, useCallback, useMemo, RefObject } from "react";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
}

function getMessagePreview(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") {
    const content = msg.content;
    if (typeof content === "string") return content.slice(0, 200);
    if (Array.isArray(content)) {
      return (content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n")
        .slice(0, 200);
    }
    return "";
  }
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    const text = blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text) return text.slice(0, 200);
    const toolNames = blocks
      .filter((b) => b.type === "toolCall")
      .map((b) => (b as { type: string; toolName: string }).toolName);
    if (toolNames.length) return toolNames.join(", ");
    return "";
  }
  return "";
}

function getNodeColor(isUser: boolean): { bg: string; border: string } {
  if (isUser) {
    return { bg: "color-mix(in oklab, var(--accent) 16%, transparent)", border: "color-mix(in oklab, var(--accent) 55%, transparent)" };
  }
  return { bg: "color-mix(in oklab, var(--text-muted) 12%, transparent)", border: "color-mix(in oklab, var(--text-muted) 40%, transparent)" };
}

function hasTextContent(msg: AgentMessage | Partial<AgentMessage>): boolean {
  if (msg.role === "user") return true;
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    return blocks.some((b) => b.type === "text");
  }
  return false;
}

interface NodeInfo {
  topRatio: number;   // 0–1 within total scroll height
  heightRatio: number;
  preview: string;    // resolved while measuring, never during render
  isUser: boolean;
  index: number;
}

const RATIO_EPSILON = 0.0005;

function sameNodes(prev: NodeInfo[], next: NodeInfo[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.isUser !== b.isUser || a.preview !== b.preview) return false;
    if (Math.abs(a.topRatio - b.topRatio) > RATIO_EPSILON) return false;
    if (Math.abs(a.heightRatio - b.heightRatio) > RATIO_EPSILON) return false;
  }
  return true;
}

export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs }: Props) {
  const [scrollRatio, setScrollRatio] = useState(0);
  const [viewportRatio, setViewportRatio] = useState(1);
  const [visible, setVisible] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [nearestIndex, setNearestIndex] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const scrollRafRef = useRef<number | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const pointerYRef = useRef(0);
  const streamingRef = useRef(false);
  streamingRef.current = streamingMessage !== null;

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage]
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  // --- 仅更新视口比例，不读取 DOM ---
  // rAF-coalesced: one layout read per frame no matter how many scroll events fire.
  const updateScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;
      const totalH = scrollEl.scrollHeight;
      const clientH = scrollEl.clientHeight;
      const scrollable = totalH - clientH;
      setVisible(scrollable > 20);
      if (scrollable <= 0) {
        setScrollRatio(0);
        setViewportRatio(1);
      } else {
        setScrollRatio(scrollEl.scrollTop / scrollable);
        setViewportRatio(clientH / totalH);
      }
    });
  }, [scrollContainer]);

  // --- 节流 DOM 测量（仅消息变化/尺寸变化时触发）---
  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    // 节流：流式期间布局一直在动，测得再密也没用
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;
      const totalH = scrollEl.scrollHeight;
      if (totalH <= 0) return;

      const refs = messageRefs.current;
      const newNodes: NodeInfo[] = [];
      let refIndex = 0;
      const allMessages = allMessagesRef.current;
      const containerRect = scrollEl.getBoundingClientRect();

      for (let i = 0; i < allMessages.length; i++) {
        const msg = allMessages[i];
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const el = refs?.[refIndex];
        refIndex++;
        if (!hasTextContent(msg)) continue;
        if (el) {
          const elRect = el.getBoundingClientRect();
          const top = elRect.top - containerRect.top + scrollEl.scrollTop;
          const h = elRect.height;
          newNodes.push({
            topRatio: top / totalH,
            heightRatio: h / totalH,
            preview: getMessagePreview(msg),
            isUser: msg.role === "user",
            index: newNodes.length,
          });
        }
      }
      setNodes((prev) => (sameNodes(prev, newNodes) ? prev : newNodes));
    }, streamingRef.current ? 500 : 150);
  }, [scrollContainer, messageRefs]);

  // scroll 事件 → 只更新视口，不碰 DOM
  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  // Keep both node positions and viewport ratios in sync with layout changes.
  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      updateScroll();
      measureNodes();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    // Also observe the scroll content for height changes
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [scrollContainer, measureNodes, updateScroll]);

  // Wait briefly for new message DOM before syncing layout.
  useEffect(() => {
    const t = setTimeout(() => {
      updateScroll();
      measureNodes();
    }, 50);
    return () => clearTimeout(t);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToMinimapRatio = useCallback((viewportTopRatio: number) => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const clamped = Math.max(0, Math.min(1 - viewportRatio, viewportTopRatio));
    el.scrollTop = (clamped / (1 - viewportRatio)) * scrollable;
  }, [scrollContainer, viewportRatio]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;
    const grabOffset = clickRatio - scrollRatio * (1 - viewportRatio);
    const insideBox = grabOffset >= 0 && grabOffset <= viewportRatio;
    const offset = insideBox ? grabOffset : viewportRatio / 2;

    scrollToMinimapRatio(clickRatio - offset);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const r = (ev.clientY - rect.top) / rect.height;
      scrollToMinimapRatio(r - offset);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [visible, viewportRatio, scrollRatio, scrollToMinimapRatio]);

  // Hover tracking: only the nearest node is observable, so resolve it on a rAF
  // and skip the state update entirely while it stays the same node.
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    pointerYRef.current = e.clientY;
    if (moveRafRef.current !== null) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null;
      const el = containerRef.current;
      const list = nodesRef.current;
      if (!el || list.length === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = (pointerYRef.current - rect.top) / rect.height;
      let best = 0;
      for (let i = 1; i < list.length; i++) {
        if (Math.abs(list[i].topRatio - ratio) < Math.abs(list[best].topRatio - ratio)) best = i;
      }
      const bestIndex = list[best].index;
      setNearestIndex((prev) => (prev === bestIndex ? prev : bestIndex));
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    setMinimapHovered(false);
    setNearestIndex(null);
  }, []);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
  }, []);

  // Compute collision-free tooltip positions for all nodes
  const TOOLTIP_HEIGHT = 22;
  const TOOLTIP_GAP = 2;
  const minimapHeightPx = containerRef.current?.clientHeight ?? 600;

  const tooltipPositions = useMemo(() => {
    if (!minimapHovered || nodes.length === 0) return [];
    // Initial positions: centered on the dot
    const positions = nodes.map((node) =>
      Math.round(node.topRatio * minimapHeightPx - TOOLTIP_HEIGHT / 2)
    );
    // Iterative push-apart to resolve overlaps (top-to-bottom pass, then bottom-to-top)
    for (let pass = 0; pass < 10; pass++) {
      for (let i = 1; i < positions.length; i++) {
        const minTop = positions[i - 1] + TOOLTIP_HEIGHT + TOOLTIP_GAP;
        if (positions[i] < minTop) positions[i] = minTop;
      }
      for (let i = positions.length - 2; i >= 0; i--) {
        const maxTop = positions[i + 1] - TOOLTIP_HEIGHT - TOOLTIP_GAP;
        if (positions[i] > maxTop) positions[i] = maxTop;
      }
    }
    // Clamp all to minimap bounds
    for (let i = 0; i < positions.length; i++) {
      positions[i] = Math.max(0, Math.min(minimapHeightPx - TOOLTIP_HEIGHT, positions[i]));
    }
    return positions;
  }, [minimapHovered, nodes, minimapHeightPx]);

  // Always occupy the rail (parent is full-height chrome). When content is short,
  // keep an empty quiet track so the rail stays continuous to the page bottom.
  if (!visible) {
    return (
      <div
        className="chat-minimap chat-minimap-empty"
        style={{ width: "100%", flex: 1, minHeight: 0 }}
        aria-hidden
      />
    );
  }

  const viewportBoxTop = scrollRatio * (1 - viewportRatio) * 100;
  const viewportBoxHeight = viewportRatio * 100;

  return (
    <div
      ref={containerRef}
      className="chat-minimap"
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setMinimapHovered(true)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      style={{
        width: "100%",
        flex: 1,
        minHeight: 0,
        position: "relative",
        cursor: "default",
        userSelect: "none",
        overflow: "visible",
        opacity: 1,
        transition: "opacity 0.15s ease",
      }}
    >
      {/* Viewport indicator — quiet thumb */}
      <div
        style={{
          position: "absolute",
          left: 4,
          right: 4,
          top: `${viewportBoxTop}%`,
          height: `${Math.max(viewportBoxHeight, 4)}%`,
          background: minimapHovered
            ? "color-mix(in oklab, var(--text) 10%, transparent)"
            : "color-mix(in oklab, var(--text) 6%, transparent)",
          borderRadius: "var(--radius-xs)",
          pointerEvents: "none",
          zIndex: 1,
          transition: "background 0.15s ease",
        }}
      />

      {/* Message nodes */}
      {nodes.map((node) => {
        const color = getNodeColor(node.isUser);
        const isNearest = minimapHovered && nearestIndex === node.index;
        const isUser = node.isUser;
        const dotTop = node.topRatio * 100;

        return (
          <div
            key={node.index}
            style={{
              position: "absolute",
              top: `${dotTop}%`,
              transform: "translateY(-50%)",
              left: 0,
              right: 0,
              height: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: isUser ? 6 : 4,
                height: isUser ? 6 : 4,
                borderRadius: isUser ? 2 : "50%",
                background: color.bg,
                border: `1px solid ${color.border}`,
                flexShrink: 0,
                transition: "transform 0.1s ease, opacity 0.1s ease",
                transform: isNearest ? "scale(1.5)" : "scale(1)",
                opacity: minimapHovered ? 1 : 0.75,
              }}
            />
          </div>
        );
      })}

      {/* Tooltips for all nodes, collision-free positions */}
      {minimapHovered && nodes.map((node, i) => {
        const preview = node.preview;
        const color = getNodeColor(node.isUser);
        const isNearest = nearestIndex === node.index;
        if (!preview || tooltipPositions.length === 0) return null;
        return (
          <div
            key={node.index}
            style={{
              position: "absolute",
              top: tooltipPositions[i],
              right: "100%",
              marginRight: 6,
              background: "var(--bg)",
              borderTop: `1px solid ${isNearest ? color.border : "var(--border)"}`,
              borderRight: `1px solid ${isNearest ? color.border : "var(--border)"}`,
              borderBottom: `1px solid ${isNearest ? color.border : "var(--border)"}`,
              borderLeft: `2px solid ${color.border}`,
              borderRadius: "var(--radius-xs)",
              padding: "2px 7px",
              width: 200,
              zIndex: 100,
              pointerEvents: "none",
              opacity: isNearest ? 1 : 0.45,
              transition: "top 0.1s, opacity 0.1s",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: isNearest ? "var(--text)" : "var(--text-muted)",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {preview}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  // Resize in place — rebuilding the array on every parent render is O(n) garbage.
  if (refs.current.length !== count) {
    const previousLength = refs.current.length;
    refs.current.length = count;
    if (count > previousLength) refs.current.fill(null, previousLength);
  }
  return refs;
}
