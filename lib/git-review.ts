import { getCommitDiffContext } from "./git-changes";
import { getRoleModelRef } from "./model-roles";
import { readWebSettings, type ModelRef } from "./web-settings";

export type { ReviewFinding, ReviewPriority, ReviewReport } from "./review-report";
export { countFindingsByPriority, parseReviewReport } from "./review-report";

export type GitReviewContext = {
  prompt: string;
  summary: string;
  fileCount: number;
  hasChanges: boolean;
  branch: string | null;
  suggestedModel: ModelRef | null;
  sessionName: string;
};

const REVIEW_DIFF_MAX_CHARS = 50_000;

function buildPrompt(diffSummary: string, fileCount: number, branch: string | null): string {
  return [
    "Perform a structured code review of the current working tree changes.",
    "",
    "Requirements:",
    "1. Spawn the `Reviewer` subagent (subagent_type: Reviewer) with a self-contained prompt that includes the diff context below.",
    "2. The Reviewer is read-only — do not edit files, stage, or commit.",
    "3. After the Reviewer finishes, surface its findings clearly to the user.",
    "4. Prefer the Reviewer's final JSON block as the source of truth for priorities and verdict.",
    "5. If the subagent tool is unavailable, do the review yourself with the same JSON output contract.",
    "",
    `Branch: ${branch ?? "unknown"}`,
    `Changed files: ${fileCount}`,
    "",
    "### Diff context",
    "```",
    diffSummary,
    "```",
    "",
    "End your own final message with the Reviewer's JSON block (or an equivalent one you produce) so the UI can render a summary card.",
  ].join("\n");
}

export async function buildGitReviewContext(
  cwd: string,
  options?: { includeUnstaged?: boolean },
): Promise<GitReviewContext> {
  const includeUnstaged = options?.includeUnstaged !== false;
  const context = await getCommitDiffContext(cwd, {
    includeUnstaged,
    maxChars: REVIEW_DIFF_MAX_CHARS,
  });
  if (!context.hasChanges) {
    return {
      prompt: "",
      summary: "",
      fileCount: 0,
      hasChanges: false,
      branch: null,
      suggestedModel: null,
      sessionName: "Git review",
    };
  }

  const branchMatch = context.summary.match(/^Branch:\s*(.+)$/m);
  const branch = branchMatch?.[1]?.trim() || null;
  const prefs = readWebSettings();
  const suggestedModel = getRoleModelRef("plan", prefs) ?? getRoleModelRef("default", prefs);
  const stamp = new Date().toISOString().slice(11, 16); // HH:MM
  const sessionName = branch
    ? `Git review · ${branch} · ${stamp}`
    : `Git review · ${stamp}`;

  return {
    prompt: buildPrompt(context.summary, context.fileCount, branch),
    summary: context.summary,
    fileCount: context.fileCount,
    hasChanges: true,
    branch,
    suggestedModel,
    sessionName,
  };
}
