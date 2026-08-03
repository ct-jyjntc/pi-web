"use client";

/**
 * Inline name input for New File / New Folder drafts in the explorer tree.
 */
import { useEffect, useRef, useState } from "react";
import { FilePlus, FolderPlus } from "lucide-react";
import { Icon } from "../Icon";
import type { DraftKind } from "./types";

interface Props {
  kind: DraftKind;
  depth: number;
  defaultName: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function DraftRow({ kind, depth, defaultName, busy, error, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // After a failed submit the parent keeps the draft mounted; allow retry.
  useEffect(() => {
    if (!busy && error) settledRef.current = false;
  }, [busy, error]);

  const commit = (name: string) => {
    if (settledRef.current || busy) return;
    settledRef.current = true;
    onSubmit(name);
  };

  const cancel = () => {
    if (settledRef.current || busy) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
        }}
      >
        <span style={{ width: 10, flexShrink: 0 }} />
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-dim)" }}>
          <Icon icon={kind === "folder" ? FolderPlus : FilePlus} size={14} strokeWidth={1.8} />
        </span>
        <input
          ref={inputRef}
          className="input-base"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const trimmed = value.trim();
              if (trimmed) commit(trimmed);
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          onBlur={() => {
            // Blur commits when non-empty; empty cancels (VS Code-like).
            const trimmed = value.trim();
            if (trimmed) commit(trimmed);
            else cancel();
          }}
          aria-label={kind === "folder" ? "New folder name" : "New file name"}
          style={{
            flex: 1,
            minWidth: 0,
            height: 20,
            padding: "0 6px",
            fontSize: 12,
            borderRadius: "var(--radius-xs)",
          }}
        />
      </div>
      {error && (
        <div
          style={{
            paddingLeft: 8 + (depth + 1) * 14,
            paddingRight: 8,
            fontSize: 10,
            color: "var(--destructive)",
            lineHeight: 1.3,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
