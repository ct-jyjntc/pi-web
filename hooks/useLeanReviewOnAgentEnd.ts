/**
 * Fire Lean Review after agent turns that likely edited files.
 * Keeps ChatWindow thin; no SSE/poll lifecycle.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import type { LeanReport } from "@/lib/lean-review-types";
import type { LeanIntensity, LeanModeSettings } from "@/lib/web-settings";

const WRITE_TOOLS = new Set([
  "edit",
  "write",
  "Bash",
  "bash",
  "multi_edit",
  "apply_patch",
  "str_replace",
  "create_file",
]);

export type LeanReviewUiState = {
  report: LeanReport;
  model?: string;
};

function toolNamesLookLikeWrites(toolNames: string[]): boolean {
  if (toolNames.length === 0) return true; // unknown — let server decide via git diff
  return toolNames.some((name) => {
    const n = name.toLowerCase();
    if (WRITE_TOOLS.has(name) || WRITE_TOOLS.has(n)) return true;
    return /edit|write|patch|create|delete|move|rename/.test(n);
  });
}

export function useLeanReviewOnAgentEnd(opts: {
  getLeanMode: () => LeanModeSettings | null | undefined;
  getCwd: () => string | null | undefined;
  getSessionId: () => string | null | undefined;
  getRecentToolNames: () => string[];
}) {
  const [leanNote, setLeanNote] = useState<LeanReviewUiState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearLeanNote = useCallback(() => setLeanNote(null), []);

  const runLeanReviewOnAgentEnd = useCallback(() => {
    const { getLeanMode, getCwd, getSessionId, getRecentToolNames } = optsRef.current;
    const lean = getLeanMode();
    if (!lean?.enabled) return;
    if (lean.intensity === "soft") return;
    if (!lean.reviewOnAgentEnd) return;

    const cwd = getCwd()?.trim();
    const sessionId = getSessionId()?.trim();
    if (!cwd || !sessionId) return;

    const tools = getRecentToolNames();
    if (!toolNamesLookLikeWrites(tools)) return;

    const intensity: LeanIntensity = lean.intensity;
    void fetch("/api/lean-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, sessionId, intensity, mode: "auto" }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as {
          skipped?: boolean;
          report?: LeanReport;
          model?: string;
        };
        if (data.skipped || !data.report) return;
        const findings = data.report.findings ?? [];
        if (findings.length === 0 && data.report.verdict !== "bloated") return;
        setLeanNote({ report: data.report, model: data.model });
      })
      .catch(() => {});
  }, []);

  return { leanNote, clearLeanNote, runLeanReviewOnAgentEnd, setLeanNote };
}
