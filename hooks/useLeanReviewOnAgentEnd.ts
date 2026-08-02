/**
 * Fire Lean Review after agent turns that likely edited files.
 * Keeps ChatWindow thin; no SSE/poll lifecycle.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import type { LeanReport } from "@/lib/lean-review-types";
import type { LeanIntensity, LeanModeSettings } from "@/lib/lean-mode-settings";
import { pathsFromAssistantContent } from "@/lib/lean-paths";

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
  if (toolNames.length === 0) return true;
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
  getRecentAssistantContent: () => unknown;
}) {
  const [leanNote, setLeanNote] = useState<LeanReviewUiState | null>(null);
  const [leanBusy, setLeanBusy] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearLeanNote = useCallback(() => setLeanNote(null), []);

  const runLeanReview = useCallback(async (mode: "auto" | "manual") => {
    const {
      getLeanMode,
      getCwd,
      getSessionId,
      getRecentToolNames,
      getRecentAssistantContent,
    } = optsRef.current;
    const lean = getLeanMode();
    if (!lean?.enabled) return;
    if (lean.intensity === "soft") return;
    if (mode === "auto" && !lean.reviewOnAgentEnd) return;

    const cwd = getCwd()?.trim();
    const sessionId = getSessionId()?.trim();
    if (!cwd || !sessionId) return;

    if (mode === "auto") {
      const tools = getRecentToolNames();
      if (!toolNamesLookLikeWrites(tools)) return;
    }

    const paths = pathsFromAssistantContent(getRecentAssistantContent());
    const intensity: LeanIntensity = lean.intensity;
    setLeanBusy(true);
    try {
      const res = await fetch("/api/lean-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          sessionId,
          intensity,
          mode,
          paths,
          allowFullWorktree: mode === "manual" && paths.length === 0,
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as {
        skipped?: boolean;
        report?: LeanReport;
        model?: string;
      };
      if (data.skipped || !data.report) {
        if (mode === "manual") setLeanNote(null);
        return;
      }
      const findings = data.report.findings ?? [];
      if (findings.length === 0 && data.report.verdict !== "bloated") {
        if (mode === "manual") {
          setLeanNote({
            report: {
              ...data.report,
              summary: data.report.summary || "No lean findings.",
              findings: [],
            },
            model: data.model,
          });
        }
        return;
      }
      setLeanNote({ report: data.report, model: data.model });
    } catch {
      // ignore
    } finally {
      setLeanBusy(false);
    }
  }, []);

  const runLeanReviewOnAgentEnd = useCallback(() => {
    void runLeanReview("auto");
  }, [runLeanReview]);

  const runLeanReviewManual = useCallback(() => {
    void runLeanReview("manual");
  }, [runLeanReview]);

  return {
    leanNote,
    leanBusy,
    clearLeanNote,
    runLeanReviewOnAgentEnd,
    runLeanReviewManual,
    setLeanNote,
  };
}
