"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useLocale } from "@/hooks/useLocale";
// xterm.css is vendored into app/globals.css — avoid PostCSS/lightningcss on the package CSS.

interface Props {
  cwd: string | null;
}

type ThemeVars = {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  destructive: string;
  border: string;
  cursor: string;
};

function readTheme(el: HTMLElement | null): ThemeVars {
  const style = el ? getComputedStyle(el) : getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => {
    const v = style.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: get("--bg", "#0f1115"),
    panel: get("--bg-panel", "#151821"),
    text: get("--text", "#e8eaed"),
    muted: get("--text-muted", "#a0a6b0"),
    dim: get("--text-dim", "#6b7280"),
    accent: get("--accent", "#7aa2f7"),
    destructive: get("--destructive", "#f7768e"),
    border: get("--border", "#2a2f3a"),
    cursor: get("--accent", "#7aa2f7"),
  };
}

export function TerminalPanel({ cwd }: Props) {
  const { t } = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const disposedRef = useRef(false);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    disposedRef.current = false;
    const host = hostRef.current;
    if (!host) return;

    if (!cwd) {
      setError(null);
      setStatus(t("git.terminalNoCwd"));
      return;
    }

    setError(null);
    setStatus(t("git.terminalConnecting"));

    const theme = readTheme(host);
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 12.5,
      lineHeight: 1.35,
      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      scrollback: 5000,
      convertEol: false,
      theme: {
        background: theme.bg,
        foreground: theme.text,
        cursor: theme.cursor,
        cursorAccent: theme.bg,
        selectionBackground: theme.accent + "59",
        black: "#1b1f27",
        red: theme.destructive,
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: theme.accent,
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: theme.text,
        brightBlack: theme.dim,
        brightRed: theme.destructive,
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: theme.accent,
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: theme.text,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    term.focus();

    termRef.current = term;
    fitRef.current = fit;

    let es: EventSource | null = null;
    let sessionId: string | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const queueWrite = (data: string) => {
      if (!sessionId) return;
      writeQueueRef.current = writeQueueRef.current
        .then(async () => {
          if (disposedRef.current || !sessionId) return;
          await fetch(`/api/cwd/pty/${sessionId}/input`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data }),
            keepalive: true,
          });
        })
        .catch(() => {
          // ignore transient write failures; stream exit will surface hard errors
        });
    };

    const sendResize = () => {
      if (!sessionId || !fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
      } catch {
        // ignore
      }
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      void fetch(`/api/cwd/pty/${sessionId}/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols, rows }),
        keepalive: true,
      }).catch(() => {});
    };

    const disposeRemote = () => {
      if (es) {
        es.close();
        es = null;
        esRef.current = null;
      }
      if (sessionId) {
        const id = sessionId;
        sessionId = null;
        sessionIdRef.current = null;
        void fetch(`/api/cwd/pty/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
    };

    const start = async () => {
      try {
        fit.fit();
        const cols = Math.max(term.cols || 80, 40);
        const rows = Math.max(term.rows || 24, 12);
        const res = await fetch("/api/cwd/pty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, cols, rows }),
        });
        const data = await res.json() as {
          id?: string;
          shell?: string;
          cwd?: string;
          error?: string;
        };
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        if (disposedRef.current) {
          void fetch(`/api/cwd/pty/${data.id}`, { method: "DELETE", keepalive: true }).catch(() => {});
          return;
        }

        sessionId = data.id;
        sessionIdRef.current = data.id;
        setStatus(null);
        setError(null);
        term.writeln(`\x1b[90m${data.shell ?? "shell"} · ${data.cwd ?? cwd}\x1b[0m`);

        es = new EventSource(`/api/cwd/pty/${data.id}/events`);
        esRef.current = es;

        es.addEventListener("data", (evt) => {
          try {
            const payload = JSON.parse((evt as MessageEvent).data) as { data?: string };
            if (payload.data) term.write(payload.data);
          } catch {
            // ignore malformed chunk
          }
        });
        es.addEventListener("exit", (evt) => {
          try {
            const payload = JSON.parse((evt as MessageEvent).data) as { exitCode?: number };
            term.writeln("");
            term.writeln(`\x1b[90m[process exited: ${payload.exitCode ?? 0}]\x1b[0m`);
          } catch {
            term.writeln("\r\n\x1b[90m[process exited]\x1b[0m");
          }
          setStatus(t("git.terminalExited"));
          disposeRemote();
        });
        es.addEventListener("error", (evt) => {
          // EventSource also fires generic error on disconnect; only handle explicit error events with data.
          const msgEvt = evt as MessageEvent;
          if (typeof msgEvt.data === "string" && msgEvt.data) {
            try {
              const payload = JSON.parse(msgEvt.data) as { error?: string };
              if (payload.error) {
                setError(payload.error);
                term.writeln(`\r\n\x1b[31m${payload.error}\x1b[0m`);
              }
            } catch {
              // ignore
            }
          }
        });
        es.onerror = () => {
          if (disposedRef.current) return;
          // Keep terminal usable for local scroll; remote is gone.
          if (sessionIdRef.current) {
            setStatus(t("git.terminalDisconnected"));
          }
        };

        term.onData((data) => queueWrite(data));

        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(sendResize, 50);
        });
        resizeObserver.observe(host);
        // Initial size sync after first paint.
        requestAnimationFrame(sendResize);
      } catch (e) {
        if (disposedRef.current) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setStatus(null);
        term.writeln(`\x1b[31m${message}\x1b[0m`);
      }
    };

    void start();

    return () => {
      disposedRef.current = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      disposeRemote();
      try {
        term.dispose();
      } catch {
        // ignore
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, t]);

  return (
    <div
      className="terminal-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        flex: 1,
        background: "var(--bg)",
        position: "relative",
      }}
    >
      {(status || error) && (
        <div
          className="terminal-status"
          style={{
            flexShrink: 0,
            minHeight: 28,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: error ? "var(--destructive)" : "var(--text-dim)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
        >
          {error || status}
        </div>
      )}
      <div
        ref={hostRef}
        className="terminal-xterm-host"
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          padding: "8px 10px 10px",
          overflow: "hidden",
        }}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
