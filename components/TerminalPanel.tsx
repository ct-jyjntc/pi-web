"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

interface Props {
  cwd: string | null;
  title?: string;
}

interface Line {
  kind: "in" | "out" | "err" | "meta";
  text: string;
}

export function TerminalPanel({ cwd }: Props) {
  const { t } = useLocale();
  const [lines, setLines] = useState<Line[]>([]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    setLines((prev) => [
      ...prev,
      { kind: "meta", text: cwd ? `$ cwd: ${cwd}` : t("git.noCwd") },
    ]);
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async () => {
    const line = cmd.trim();
    if (!line || !cwd || busy) return;
    setCmd("");
    setLines((prev) => [...prev, { kind: "in", text: `$ ${line}` }]);
    setBusy(true);
    try {
      const res = await fetch("/api/cwd/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, command: line }),
      });
      const data = await res.json() as {
        ok?: boolean;
        stdout?: string;
        stderr?: string;
        code?: number | null;
        error?: string;
      };
      if (!res.ok || data.error) {
        setLines((prev) => [...prev, { kind: "err", text: data.error ?? `HTTP ${res.status}` }]);
      } else {
        if (data.stdout) setLines((prev) => [...prev, { kind: "out", text: data.stdout! }]);
        if (data.stderr) setLines((prev) => [...prev, { kind: "err", text: data.stderr! }]);
        if (data.code != null && data.code !== 0) {
          setLines((prev) => [...prev, { kind: "meta", text: `exit ${data.code}` }]);
        }
      }
    } catch (e) {
      setLines((prev) => [...prev, { kind: "err", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, cmd, cwd]);

  return (
    <div className="terminal-panel" onClick={() => inputRef.current?.focus()}>
      <div ref={scrollerRef} className="terminal-scroll">
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color:
                line.kind === "in" ? "var(--text)"
                  : line.kind === "err" ? "var(--destructive)"
                    : line.kind === "meta" ? "var(--text-dim)"
                      : "var(--text-muted)",
              marginBottom: 2,
            }}
          >
            {line.text}
          </div>
        ))}
        {busy && <div style={{ color: "var(--text-dim)" }}>…</div>}
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={cmd}
          disabled={!cwd || busy}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          placeholder={cwd ? t("git.terminalPlaceholder") : t("git.noCwd")}
        />
      </div>
    </div>
  );
}
