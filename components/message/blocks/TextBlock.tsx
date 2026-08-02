"use client";

import { MarkdownBody } from "../../MarkdownBody";
import type { TextContent } from "@/lib/types";

export function TextBlock({ block, isStreaming, cwd, onOpenFile, processStyle }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string) => void; processStyle?: boolean }) {
  const body = (
    <MarkdownBody
      isStreaming={isStreaming}
      cwd={cwd}
      onOpenFile={onOpenFile}
    >
      {block.text}
    </MarkdownBody>
  );
  if (!processStyle) return body;
  // Inline styles so process prose stays muted even if globals.css HMR lags.
  return (
    <div
      style={{
        color: "var(--text-muted)",
        fontSize: 12,
        lineHeight: 1.5,
        opacity: 0.9,
      }}
    >
      {body}
    </div>
  );
}

/**
 * Hermes-style thinking disclosure: auto-open while streaming, auto-collapse
 * when settled, with "Thought for Ns" labels. First explicit user toggle wins.
 */

