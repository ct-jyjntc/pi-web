"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Icon } from "../../Icon";
import { useLocale } from "@/hooks/useLocale";
import { formatThoughtDuration } from "@/lib/message-display";
import { useWebSettings } from "@/lib/web-settings-store";
import type { ThinkingContent } from "@/lib/types";
import { loadThinkingContent } from "../message-view-utils";

export function ThinkingBlock({
  block, duration, isStreaming, sessionId, entryId, blockIndex,
}: {
  block: ThinkingContent;
  duration?: number;
  isStreaming?: boolean;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
}) {
  const { t } = useLocale();
  // null = no explicit user toggle yet → defer to streaming/settings default.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webSettings = useWebSettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pending = Boolean(isStreaming);

  const defaultOpen = pending || webSettings?.showThinking === true;
  const open = userOpen ?? defaultOpen;
  const isPreview = pending && userOpen === null;

  const loadDeferred = useCallback(async () => {
    if (!block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(t("msg.thinkingUnavailable"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setContent(await loadThinkingContent(sessionId, entryId, blockIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [block.deferred, blockIndex, content, entryId, sessionId, t]);

  // Load deferred body when the disclosure opens.
  useEffect(() => {
    if (open && block.deferred && content === null && !loading && !error) {
      void loadDeferred();
    }
  }, [open, block.deferred, content, loading, error, loadDeferred]);

  // While the live preview is open, pin the scroll container to the bottom on
  // content growth so the latest tokens stay visible (Hermes ThinkingDisclosure).
  useEffect(() => {
    if (!isPreview || !open) return;
    const el = scrollRef.current;
    const body = contentRef.current;
    if (!el || !body) return;
    let lastHeight = -1;
    const pin = (entries: readonly ResizeObserverEntry[]) => {
      const height = entries[entries.length - 1]?.borderBoxSize?.[0]?.blockSize ?? -1;
      const grew = height < 0 || height > lastHeight;
      lastHeight = height;
      if (grew) el.scrollTop = el.scrollHeight;
    };
    const observer = new ResizeObserver(pin);
    observer.observe(body);
    return () => observer.disconnect();
  }, [isPreview, open]);

  const toggle = () => {
    const next = !open;
    setUserOpen(next);
    if (next) void loadDeferred();
  };

  let label = t("msg.thinkingLive");
  if (!pending) {
    if (duration == null) label = t("msg.thought");
    else if (duration < 1) label = t("msg.thoughtBriefly");
    else label = t("msg.thoughtFor", { duration: formatThoughtDuration(duration) });
  }

  const bodyText = loading
    ? t("msg.loadingThinking")
    : error ?? (block.deferred ? content : block.thinking);

  // Empty non-streaming thinking with no deferred payload is pure noise.
  if (!pending && !block.deferred && !(block.thinking?.trim()) && duration == null) {
    return null;
  }

  return (
    <div
      data-slot="thinking-disclosure"
      style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, opacity: 0.82 }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "auto",
          maxWidth: "100%",
          minHeight: 22,
          padding: "1px 0",
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Icon
          icon={ChevronRight}
          size={10}
          strokeWidth={1.6}
          style={{
            flexShrink: 0,
            opacity: 0.55,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
        <span
          className={pending ? "tool-run-live" : undefined}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {pending && duration != null && duration > 0 && (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {formatThoughtDuration(duration)}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={scrollRef}
          style={{
            marginTop: 4,
            maxHeight: isPreview ? "10rem" : undefined,
            overflow: isPreview ? "auto" : undefined,
            overscrollBehavior: isPreview ? "contain" : undefined,
          }}
        >
          <div
            ref={contentRef}
            style={{
              color: error ? "var(--destructive)" : "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              opacity: 0.9,
            }}
          >
            {bodyText}
          </div>
        </div>
      )}
    </div>
  );
}



