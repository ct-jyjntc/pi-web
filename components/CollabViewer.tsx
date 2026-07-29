"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseCollabChat, type CollabChatMessage } from "@/lib/collab-messages";

export function CollabViewer({ token }: { token: string }) {
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    sessionId?: string;
    note?: string;
    createdAt?: string;
  } | null>(null);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [size, setSize] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [stickBottom, setStickBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;

    const loadMeta = async () => {
      try {
        const res = await fetch(`/api/collab/${encodeURIComponent(token)}`);
        const data = await res.json() as {
          error?: string;
          share?: { sessionId?: string; note?: string; createdAt?: string };
          snapshot?: {
            preview?: string;
            lines?: string[];
            size?: number;
            mtimeMs?: number;
            exists?: boolean;
            truncated?: boolean;
          };
        };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setMeta({
          sessionId: data.share?.sessionId,
          note: data.share?.note,
          createdAt: data.share?.createdAt,
        });
        if (Array.isArray(data.snapshot?.lines) && data.snapshot.lines.length > 0) {
          setRawLines(data.snapshot.lines.filter((l) => l.length > 0));
        } else if (data.snapshot?.preview) {
          setRawLines(data.snapshot.preview.split("\n").filter((l) => l.length > 0));
        }
        if (typeof data.snapshot?.size === "number") setSize(data.snapshot.size);
        if (typeof data.snapshot?.mtimeMs === "number") setUpdatedAt(data.snapshot.mtimeMs);
        setTruncated(Boolean(data.snapshot?.truncated));
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void loadMeta();

    es = new EventSource(`/api/collab/${encodeURIComponent(token)}/events`);
    es.addEventListener("ready", () => {
      if (!cancelled) setStatus("live");
    });
    es.addEventListener("update", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          size?: number;
          mtimeMs?: number;
          lines?: string[];
        };
        if (cancelled) return;
        if (Array.isArray(data.lines)) {
          setRawLines(data.lines.filter((l) => typeof l === "string" && l.length > 0));
        }
        if (typeof data.size === "number") setSize(data.size);
        if (typeof data.mtimeMs === "number") setUpdatedAt(data.mtimeMs);
        if (typeof (data as { truncated?: boolean }).truncated === "boolean") {
          setTruncated(Boolean((data as { truncated?: boolean }).truncated));
        }
        setStatus("live");
      } catch {
        // ignore
      }
    });
    es.onerror = () => {
      if (!cancelled) setStatus((s) => (s === "error" ? s : "connecting"));
    };

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [token]);

  const messages: CollabChatMessage[] = useMemo(
    () => parseCollabChat(rawLines, 500),
    [rawLines],
  );

  useEffect(() => {
    if (!stickBottom) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, stickBottom]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickBottom(dist < 80);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "12px 16px",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>Pi Web · Collab</div>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--border)",
            color: status === "live" ? "var(--success)" : status === "error" ? "var(--destructive)" : "var(--text-muted)",
            background: "var(--bg-subtle)",
          }}
        >
          {status === "live" ? "live" : status === "error" ? "error" : "connecting"}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          read-only
        </span>
        {meta?.sessionId && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {meta.sessionId.slice(0, 8)}…
          </span>
        )}
        {size != null && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{size.toLocaleString()} bytes</span>
        )}
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {messages.length} messages{truncated ? " · history truncated" : ""}
        </span>
        {updatedAt != null && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
          Viewers cannot prompt or control the agent
        </span>
      </header>

      {meta?.note && (
        <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
          {meta.note}
        </div>
      )}

      {error ? (
        <div style={{ padding: 24, color: "var(--destructive)" }}>{error}</div>
      ) : (
        <main
          ref={scrollerRef}
          onScroll={onScroll}
          style={{ flex: 1, overflow: "auto", padding: "16px 16px 40px" }}
        >
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                Waiting for session activity…
              </div>
            ) : (
              messages.map((m) => <ChatBubble key={m.id} message={m} />)
            )}
            <div ref={bottomRef} />
          </div>
        </main>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: CollabChatMessage }) {
  if (message.role === "meta") {
    return (
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-dim)", padding: "4px 0" }}>
        {message.blocks.map((b, i) => (b.kind === "text" ? <span key={i}>{b.text}</span> : null))}
      </div>
    );
  }

  const isUser = message.role === "user";
  const isTool = message.role === "toolResult";
  const align = isUser ? "flex-end" : "flex-start";
  const bg = isUser
    ? "var(--user-bg)"
    : isTool
      ? "var(--tool-bg)"
      : "var(--assistant-bg)";
  const label =
    message.role === "user" ? "You"
      : message.role === "assistant" ? "Assistant"
        : message.role === "toolResult" ? "Tool"
          : message.role;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align, gap: 4 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          padding: "0 4px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          maxWidth: "min(100%, 640px)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: bg,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {message.blocks.map((b, i) => {
          if (b.kind === "text") {
            return (
              <div key={i} style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {b.text}
              </div>
            );
          }
          if (b.kind === "thinking") {
            return (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  borderLeft: "2px solid var(--border)",
                  paddingLeft: 8,
                  whiteSpace: "pre-wrap",
                }}
              >
                {b.text}
              </div>
            );
          }
          if (b.kind === "tool") {
            return (
              <div
                key={i}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 8px",
                  background: "var(--bg-subtle)",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--accent)" }}>{b.name}</span>
                {b.inputPreview && (
                  <div style={{ color: "var(--text-dim)", marginTop: 4, wordBreak: "break-all" }}>{b.inputPreview}</div>
                )}
              </div>
            );
          }
          // toolResult
          return (
            <div
              key={i}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                border: `1px solid ${b.isError ? "var(--destructive-border)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                padding: "6px 8px",
                background: b.isError ? "var(--destructive-bg)" : "var(--bg-subtle)",
                color: b.isError ? "var(--destructive)" : "var(--text-muted)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {b.name && <div style={{ fontWeight: 600, marginBottom: 4 }}>{b.name}</div>}
              {b.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
