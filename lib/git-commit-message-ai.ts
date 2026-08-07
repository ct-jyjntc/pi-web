import { draftCommitMessage, getCommitDiffContext } from "./git-changes";
import { assistantText } from "./message-text";
import { completeWithUtilityModel } from "./utility-model";
import { readWebSettings } from "./web-settings";

const AI_TIMEOUT_MS = 25_000;
// Do not pass a tight maxTokens: for reasoning models the SDK budget is shared
// with thinking (see pi-ai adjustMaxTokensForThinking). A low cap (e.g. 220)
// often yields stopReason=length with empty text blocks → "empty commit message".
// Omitting maxTokens uses model.maxTokens and still reserves answer room.

export type CommitMessageDraft = {
  message: string;
  source: "ai" | "heuristic";
};

function sanitizeCommitMessage(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  // Drop common markdown fences / labels the model may wrap around the answer.
  text = text.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim();
  text = text.replace(/^(?:commit message|message)\s*:\s*/i, "").trim();
  if (
    (text.startsWith("\"") && text.endsWith("\""))
    || (text.startsWith("'") && text.endsWith("'"))
    || (text.startsWith("`") && text.endsWith("`"))
  ) {
    text = text.slice(1, -1).trim();
  }

  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length > 0 && !lines[0]?.trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
  if (lines.length === 0) return "";

  const subject = (lines[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 72);
  const body = lines.slice(1).join("\n").trim();
  if (!subject) return "";
  if (!body) return subject;

  const bodyLines = body.split("\n").filter((line, index) => index <= 8);
  const compactBody = bodyLines.join("\n").trim().slice(0, 600);
  return compactBody ? `${subject}\n\n${compactBody}` : subject;
}

/**
 * AI commit message for the Generate button.
 * Uses Settings → commit model when set, otherwise the app default/available model.
 */
export async function draftCommitMessageWithAi(
  cwd: string,
  options?: { includeUnstaged?: boolean },
): Promise<CommitMessageDraft> {
  const context = await getCommitDiffContext(cwd, {
    includeUnstaged: options?.includeUnstaged,
  });
  if (!context.hasChanges) {
    throw new Error(options?.includeUnstaged ? "No changes to commit" : "No staged changes");
  }

  const prefs = readWebSettings();
  // Prefer explicit commit model, then smol role, then default utility resolution.
  const preferred = prefs.commitModel ?? prefs.modelRoles.smol ?? null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const { response } = await completeWithUtilityModel(cwd, preferred, {
      systemPrompt: [
        "You write concise git commit messages.",
        "Rules:",
        "- Output only the commit message text. No markdown fences, no quotes, no preamble.",
        "- First line: imperative subject, max 72 characters.",
        "- Optional body: at most 3 short lines after one blank line.",
        "- Prefer a conventional commit type prefix when clear (feat, fix, refactor, docs, test, chore, style, perf).",
        "- Describe only what is present in the provided change summary. Do not invent intent.",
        "- Prefer English unless the diff content is clearly non-English and a matching language fits better.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: [
          "Write a commit message for these changes:",
          "",
          context.summary,
        ].join("\n"),
        timestamp: Date.now(),
      }],
    }, {
      temperature: 0.2,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      cacheRetention: "none",
      signal: controller.signal,
    });

    if (response.stopReason === "error" || response.stopReason === "aborted") {
      throw new Error(
        response.errorMessage
          ?? (controller.signal.aborted ? "AI commit message timed out" : "AI commit message failed"),
      );
    }

    const message = sanitizeCommitMessage(assistantText(response));
    if (!message) {
      throw new Error("AI returned an empty commit message");
    }
    return { message, source: "ai" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Heuristic (filename/stat) draft used when the commit box is left empty. */
export async function draftCommitMessageHeuristic(
  cwd: string,
  options?: { includeUnstaged?: boolean },
): Promise<CommitMessageDraft> {
  const message = await draftCommitMessage(cwd, options);
  return { message, source: "heuristic" };
}
