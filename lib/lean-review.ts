/**
 * Post-edit Lean Review: high-signal anti-bloat check over a bounded git diff.
 * Fire-and-forget from ChatWindow; no SSE/poll lifecycle.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import {
  bindUtilityComplete,
  pickUtilityCompleteReasoning,
  resolveUtilityModel,
  type ResolvedUtilityModel,
} from "./utility-model";
import { getRoleModelRef } from "./model-roles";
import { assistantText as getText } from "./message-text";
import { resolveLeanMode } from "./lean-settings";
import type { LeanIntensity } from "./lean-mode-settings";
import {
  readWebSettings,
  type ModelRef,
  type WebSettings,
} from "./web-settings";
import type {
  LeanFinding,
  LeanFindingKind,
  LeanReport,
  LeanReviewResult,
} from "./lean-review-types";

export type {
  LeanFinding,
  LeanFindingKind,
  LeanReport,
  LeanReviewResult,
} from "./lean-review-types";

const execFileAsync = promisify(execFile);

const MAX_DIFF_CHARS = 14_000;
const MAX_FINDINGS = 5;

const KINDS = new Set<LeanFindingKind>([
  "stacked_recovery",
  "swallow_error",
  "missing_owner",
  "dual_path",
  "file_bloat",
  "patch_without_invariant",
]);

const SEVERITIES = new Set(["P1", "P2", "P3"]);

async function resolveReviewModel(cwd: string, prefs: WebSettings): Promise<ResolvedUtilityModel> {
  const refs: Array<ModelRef | null> = [
    getRoleModelRef("smol", prefs),
    getRoleModelRef("plan", prefs),
    getRoleModelRef("default", prefs),
  ];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref) continue;
    const key = `${ref.provider}/${ref.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      return await resolveUtilityModel(cwd, ref);
    } catch {
      // try next
    }
  }
  return resolveUtilityModel(cwd, null);
}

/** Read-only worktree diff; empty when not a git repo or clean. */
export async function collectWorktreeDiff(cwd: string): Promise<{ diff: string; truncated: boolean }> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-color", "--no-ext-diff", "HEAD"],
      {
        cwd,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "1" },
      },
    );
    let diff = (stdout ?? "").trim();
    // Include untracked as empty-file diffs is heavy; also try staged+unstaged combined:
    if (!diff) {
      const unstaged = await execFileAsync("git", ["diff", "--no-color", "--no-ext-diff"], {
        cwd,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "1" },
      });
      diff = (unstaged.stdout ?? "").trim();
    }
    if (!diff) return { diff: "", truncated: false };
    if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false };
    return { diff: `${diff.slice(0, MAX_DIFF_CHARS)}\n\n…[diff truncated]`, truncated: true };
  } catch {
    return { diff: "", truncated: false };
  }
}

function buildSystemPrompt(intensity: LeanIntensity): string {
  const hardExtra =
    intensity === "hard"
      ? [
          "HARD intensity: include P3 when useful (still max 5 findings).",
          "If self_check fields are false, include at least one patch_without_invariant finding.",
        ].join(" ")
      : "REVIEW intensity: only report P1 and P2 (drop P3).";

  return [
    "You are a lean-code reviewer for a coding agent patch.",
    "Judge CHANGE SHAPE only: stacked recovery, swallowed errors, missing single owner,",
    "dual implementations without removal condition, file bloat, patch without named invariant.",
    "Do NOT report style nits, pre-existing debt, or correctness bugs unless they are bloat-shaped.",
    "Dual-path findings MUST name both the old and new paths/modules in the body; otherwise omit.",
    "Prefer zero findings when the diff is a clean, minimal fix.",
    hardExtra,
    "Reply with ONLY JSON (no markdown fences):",
    JSON.stringify({
      verdict: "lean | bloated | unclear",
      summary: "1-2 sentences",
      findings: [
        {
          kind: "stacked_recovery|swallow_error|missing_owner|dual_path|file_bloat|patch_without_invariant",
          severity: "P1|P2|P3",
          title: "short",
          body: "what + why",
          file_path: "optional",
          suggestion: "optional better shape",
        },
      ],
      self_check: {
        invariant_stated: true,
        owner_stated: true,
        path_count_ok: true,
      },
    }),
  ].join("\n");
}

function looksLikeDualPathBody(body: string): boolean {
  // Weak heuristic: need two path-ish tokens or explicit "vs"/"instead of"/"dual".
  const paths = body.match(/[\w./-]+\.[a-zA-Z]{1,8}/g) ?? [];
  if (paths.length >= 2) return true;
  return /\b(vs\.?|versus|instead of|dual[- ]?path|legacy|compat)\b/i.test(body);
}

function parseLeanReport(raw: string, intensity: LeanIntensity): LeanReport | null {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const verdict =
    rec.verdict === "lean" || rec.verdict === "bloated" || rec.verdict === "unclear"
      ? rec.verdict
      : "unclear";
  const summary = typeof rec.summary === "string" ? rec.summary.trim().slice(0, 400) : "";
  const sc = isRecord(rec.self_check) ? rec.self_check : {};
  const self_check = {
    invariant_stated: sc.invariant_stated === true,
    owner_stated: sc.owner_stated === true,
    path_count_ok: sc.path_count_ok === true,
  };

  const findings: LeanFinding[] = [];
  if (Array.isArray(rec.findings)) {
    for (const item of rec.findings) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const f = item as Record<string, unknown>;
      const kind = typeof f.kind === "string" ? f.kind : "";
      const severity = typeof f.severity === "string" ? f.severity : "";
      const title = typeof f.title === "string" ? f.title.trim() : "";
      const body = typeof f.body === "string" ? f.body.trim() : "";
      if (!KINDS.has(kind as LeanFindingKind) || !SEVERITIES.has(severity) || !title || !body) continue;
      if (intensity === "review" && severity === "P3") continue;
      if (kind === "dual_path" && !looksLikeDualPathBody(body)) continue;
      findings.push({
        kind: kind as LeanFindingKind,
        severity: severity as LeanFinding["severity"],
        title: title.slice(0, 120),
        body: body.slice(0, 600),
        file_path: typeof f.file_path === "string" ? f.file_path.slice(0, 400) : undefined,
        suggestion: typeof f.suggestion === "string" ? f.suggestion.slice(0, 400) : undefined,
      });
      if (findings.length >= MAX_FINDINGS) break;
    }
  }

  if (intensity === "hard") {
    const scFailed =
      !self_check.invariant_stated || !self_check.owner_stated || !self_check.path_count_ok;
    if (scFailed && !findings.some((f) => f.kind === "patch_without_invariant")) {
      findings.unshift({
        kind: "patch_without_invariant",
        severity: "P2",
        title: "Missing lean self-check",
        body: "Hard intensity expects invariant / single owner / path count to be stated for code-changing turns.",
        suggestion: "State the invariant, owner module, and recovery path count in the final reply.",
      });
      if (findings.length > MAX_FINDINGS) findings.length = MAX_FINDINGS;
    }
  }

  return { verdict, summary, findings, self_check };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function runLeanReview(opts: {
  cwd: string;
  sessionId: string;
  intensity?: LeanIntensity;
  mode: "auto" | "manual";
}): Promise<LeanReviewResult> {
  const { cwd, mode } = opts;
  const prefs = readWebSettings();
  const lean = resolveLeanMode(cwd, prefs);
  if (!lean.enabled) return { skipped: true, reason: "disabled" };

  const intensity = opts.intensity ?? lean.intensity;
  if (intensity === "soft") return { skipped: true, reason: "soft-no-review" };
  if (mode === "auto" && !lean.reviewOnAgentEnd) {
    return { skipped: true, reason: "review-on-end-off" };
  }

  const { diff, truncated } = await collectWorktreeDiff(cwd);
  if (!diff) return { skipped: true, reason: "no-diff" };

  let resolved: ResolvedUtilityModel;
  try {
    resolved = await resolveReviewModel(cwd, prefs);
  } catch {
    return { skipped: true, reason: "no-model" };
  }

  const completeSimple = bindUtilityComplete(resolved);
  const reasoning = pickUtilityCompleteReasoning(resolved.model);
  const modelLabel = `${resolved.model.provider}/${resolved.model.id}`;

  try {
    const response = await completeSimple(resolved.model, {
      systemPrompt: buildSystemPrompt(intensity),
      messages: [
        {
          role: "user",
          content: [
            `Intensity: ${intensity}`,
            truncated ? "Note: diff was truncated for size." : "",
            "Worktree diff (focus on agent-shaped change smells):",
            "",
            diff,
          ]
            .filter(Boolean)
            .join("\n"),
          timestamp: Date.now(),
        },
      ],
    }, {
      maxTokens: 900,
      temperature: 0.1,
      timeoutMs: 60_000,
      maxRetries: 0,
      cacheRetention: "none",
      ...(reasoning ? { reasoning } : {}),
    });

    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return { skipped: true, reason: "model-error", model: modelLabel };
    }

    const report = parseLeanReport(getText(response), intensity);
    if (!report) return { skipped: true, reason: "bad-json", model: modelLabel };
    return { skipped: false, report, model: modelLabel, truncated };
  } catch {
    return { skipped: true, reason: "model-error", model: modelLabel };
  }
}
