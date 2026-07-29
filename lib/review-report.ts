/** Client-safe review report types + parsers (no Node APIs). */

export type ReviewPriority = "P0" | "P1" | "P2" | "P3";

export type ReviewFinding = {
  title: string;
  body: string;
  priority: ReviewPriority;
  confidence?: number;
  file_path?: string;
  line_start?: number;
  line_end?: number;
};

export type ReviewReport = {
  overall_correctness: "correct" | "incorrect";
  explanation: string;
  confidence?: number;
  findings: ReviewFinding[];
};

function isPriority(value: unknown): value is ReviewPriority {
  if (typeof value !== "string") return false;
  const v = value.trim().toUpperCase();
  return v === "P0" || v === "P1" || v === "P2" || v === "P3";
}

function normalizePriority(value: unknown): ReviewPriority | null {
  if (!isPriority(value)) return null;
  return String(value).trim().toUpperCase() as ReviewPriority;
}

function normalizeCorrectness(value: unknown, findings: ReviewFinding[]): "correct" | "incorrect" | null {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["correct", "pass", "ok", "approved", "lgtm", "good"].includes(v)) return "correct";
    if (["incorrect", "fail", "failed", "needs_fix", "needs-work", "blocked", "reject", "rejected"].includes(v)) {
      return "incorrect";
    }
  }
  // Infer from findings when verdict is missing/nonstandard.
  if (findings.some((f) => f.priority === "P0" || f.priority === "P1")) return "incorrect";
  if (findings.length > 0 && value == null) return "incorrect";
  if (Array.isArray(findings)) return findings.length === 0 ? "correct" : null;
  return null;
}

/**
 * Extract the last fenced JSON review report from assistant text.
 */
export function parseReviewReport(text: string): ReviewReport | null {
  if (!text.trim()) return null;

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let lastJson: string | null = null;
  while ((match = fenceRe.exec(text)) !== null) {
    const body = match[1]?.trim() ?? "";
    if (body.includes("overall_correctness") || body.includes("findings")) {
      lastJson = body;
    }
  }

  if (!lastJson) {
    const idx = Math.max(
      text.lastIndexOf("\"overall_correctness\""),
      text.lastIndexOf("\"findings\""),
    );
    if (idx === -1) return null;
    const start = text.lastIndexOf("{", idx);
    if (start === -1) return null;
    let depth = 0;
    let endIdx = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) return null;
    lastJson = text.slice(start, endIdx + 1);
  }

  try {
    const raw = JSON.parse(lastJson) as Record<string, unknown>;
    const findingsRaw = Array.isArray(raw.findings) ? raw.findings : [];
    const findings: ReviewFinding[] = [];
    for (const item of findingsRaw) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const priority = normalizePriority(f.priority);
      if (!priority) continue;

      const title =
        typeof f.title === "string" ? f.title
          : typeof f.message === "string" ? f.message.split(/[.。]/)[0]!.slice(0, 80)
            : typeof f.summary === "string" ? f.summary
              : `${priority} finding`;
      const body =
        typeof f.body === "string" ? f.body
          : typeof f.message === "string" ? f.message
            : typeof f.detail === "string" ? f.detail
              : title;
      const file_path =
        typeof f.file_path === "string" ? f.file_path
          : typeof f.file === "string" ? f.file
            : typeof f.path === "string" ? f.path
              : undefined;
      const line_start =
        typeof f.line_start === "number" ? f.line_start
          : typeof f.line === "number" ? f.line
            : undefined;
      const line_end = typeof f.line_end === "number" ? f.line_end : undefined;

      findings.push({
        title: title.trim() || `${priority} finding`,
        body: body.trim() || title,
        priority,
        confidence: typeof f.confidence === "number" ? f.confidence : undefined,
        file_path,
        line_start,
        line_end,
      });
    }

    const correctness = normalizeCorrectness(raw.overall_correctness, findings);
    if (!correctness) return null;

    const explanation =
      typeof raw.explanation === "string" ? raw.explanation
        : typeof raw.summary === "string" ? raw.summary
          : typeof raw.verdict === "string" ? raw.verdict
            : "";

    return {
      overall_correctness: correctness,
      explanation,
      confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
      findings,
    };
  } catch {
    return null;
  }
}

export function countFindingsByPriority(findings: ReviewFinding[]): Record<ReviewPriority, number> {
  const counts: Record<ReviewPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) counts[f.priority] += 1;
  return counts;
}
