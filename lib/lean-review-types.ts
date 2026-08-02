/**
 * Shared Lean Review report types (safe for client + server imports).
 */

export type LeanFindingKind =
  | "stacked_recovery"
  | "swallow_error"
  | "missing_owner"
  | "dual_path"
  | "file_bloat"
  | "patch_without_invariant";

export type LeanFinding = {
  kind: LeanFindingKind;
  severity: "P1" | "P2" | "P3";
  title: string;
  body: string;
  file_path?: string;
  suggestion?: string;
};

export type LeanReport = {
  verdict: "lean" | "bloated" | "unclear";
  summary: string;
  findings: LeanFinding[];
  self_check: {
    invariant_stated: boolean;
    owner_stated: boolean;
    path_count_ok: boolean;
  };
};

export type LeanReviewResult = {
  skipped: boolean;
  reason?: string;
  report?: LeanReport;
  model?: string;
  truncated?: boolean;
};
