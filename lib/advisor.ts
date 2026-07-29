/**
 * Lightweight advisor: review the latest agent turn with a secondary model.
 */
import type { AssistantMessage, Context, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { pickUtilityCompleteReasoning, resolveUtilityModel } from "./utility-model";
import { getRoleModelRef } from "./model-roles";
import { readWebSettings } from "./web-settings";

export type AdvisorNote = {
  level: "info" | "concern" | "blocker";
  text: string;
  model: string;
};

type CompleteSimpleFn = (
  model: Model<string>,
  context: Context,
  options?: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxRetries?: number;
    cacheRetention?: "none" | "short" | "long";
    reasoning?: ThinkingLevel;
  },
) => Promise<AssistantMessage>;

function getText(message: AssistantMessage): string {
  return message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function runAdvisorReview(
  cwd: string,
  input: { userText: string; assistantText: string; toolSummary?: string },
): Promise<AdvisorNote | null> {
  const prefs = readWebSettings();
  if (!prefs.advisorEnabled) return null;

  const preferred = prefs.advisorModel ?? getRoleModelRef("plan", prefs) ?? getRoleModelRef("default", prefs);
  const resolved = await resolveUtilityModel(cwd, preferred);
  const completeSimple = resolved.modelRuntime.completeSimple.bind(
    resolved.modelRuntime,
  ) as CompleteSimpleFn;
  const reasoning = pickUtilityCompleteReasoning(resolved.model);

  const response = await completeSimple(resolved.model, {
    systemPrompt: [
      "You are a silent advisor reviewing another coding agent turn.",
      "Reply with ONLY JSON: {\"level\":\"info\"|\"concern\"|\"blocker\",\"text\":\"...\"}",
      "level=info: optional tip; concern: likely issue; blocker: serious mistake to fix before continuing.",
      "Be concise (1-3 sentences). No markdown fences.",
    ].join("\n"),
    messages: [{
      role: "user",
      content: [
        "User request:",
        input.userText.slice(0, 4000),
        "",
        "Assistant reply:",
        input.assistantText.slice(0, 6000),
        "",
        "Tools used:",
        (input.toolSummary ?? "(none)").slice(0, 2000),
      ].join("\n"),
      timestamp: Date.now(),
    }],
  }, {
    maxTokens: 300,
    temperature: 0.2,
    timeoutMs: 45_000,
    maxRetries: 0,
    cacheRetention: "none",
    ...(reasoning ? { reasoning } : {}),
  });

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    return null;
  }

  let raw = getText(response).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);
    const parsed = JSON.parse(raw) as { level?: string; text?: string };
    const level = parsed.level === "blocker" || parsed.level === "concern" || parsed.level === "info"
      ? parsed.level
      : "info";
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) return null;
    return {
      level,
      text,
      model: `${resolved.ref.provider}/${resolved.ref.modelId}`,
    };
  } catch {
    const text = getText(response).slice(0, 400);
    if (!text) return null;
    return { level: "info", text, model: `${resolved.ref.provider}/${resolved.ref.modelId}` };
  }
}
