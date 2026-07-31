/**
 * Optional model-backed project memory reflection (omp-style reflect, lite).
 * Falls back to heuristic clustering when no utility model is available.
 */
import {
  listMemoryFacts,
  recallMemoryFacts,
  reflectMemoryHeuristic,
  retainMemoryFact,
  type MemoryFact,
  type MemoryReflection,
} from "./project-memory";
import { assistantText as getText } from "./message-text";
import { completeWithUtilityModel } from "./utility-model";
import { getRoleModelRef } from "./model-roles";
import { readWebSettings } from "./web-settings";

export type ReflectOptions = {
  focus?: string;
  limit?: number;
  /** Prefer LLM synthesis when a utility model is available (default true). */
  useModel?: boolean;
  /** Persist a short summary fact tagged `reflect` (default false). */
  retain?: boolean;
};

export async function runMemoryReflect(
  cwd: string,
  options: ReflectOptions = {},
): Promise<MemoryReflection> {
  const focus = options.focus?.trim() || "";
  const limit = Math.min(80, Math.max(5, options.limit ?? 40));
  const useModel = options.useModel !== false;

  const base = reflectMemoryHeuristic(cwd, { focus, limit });
  if (base.factCount === 0) {
    return {
      ...base,
      summary: "No project memory facts yet. Use memory_retain to store durable conventions first.",
    };
  }

  if (!useModel) {
    return finalize(cwd, base, options.retain);
  }

  try {
    const prefs = readWebSettings();
    const preferred =
      getRoleModelRef("smol", prefs) ??
      prefs.titleModel ??
      getRoleModelRef("default", prefs);
    const facts: MemoryFact[] = focus
      ? recallMemoryFacts(cwd, focus, limit)
      : listMemoryFacts(cwd).slice(0, limit);

    const bulletList = facts
      .map((f, i) => `${i + 1}. [${f.id}] (imp=${f.importance.toFixed(2)}; tags=${f.tags.join(",") || "-"}) ${f.text}`)
      .join("\n");

    const { response, resolved } = await completeWithUtilityModel(cwd, preferred ?? undefined, {
      systemPrompt: [
        "You synthesize a durable mental model of a software project from stored memory facts.",
        "Write concise Markdown with these sections exactly:",
        "## Mental model",
        "## Conventions",
        "## Architecture notes",
        "## Pitfalls / do-nots",
        "## Open questions",
        "Use only the facts provided. Do not invent repo paths or APIs not implied by the facts.",
        "If a section has nothing, write `- (none)`. Keep under ~350 words.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: [
          focus ? `Focus query: ${focus}` : "Focus: whole project memory",
          "",
          "Facts:",
          bulletList,
        ].join("\n"),
        timestamp: Date.now(),
      }],
    }, {
      maxTokens: 900,
      temperature: 0.2,
      timeoutMs: 60_000,
      maxRetries: 0,
      cacheRetention: "none",
    });

    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return finalize(cwd, base, options.retain);
    }

    const modelText = getText(response);
    if (!modelText || modelText.length < 40) {
      return finalize(cwd, base, options.retain);
    }

    const modelName = `${resolved.model.provider}/${resolved.model.id}`;
    const summary = [
      `# Project memory reflection${focus ? ` (focus: ${focus})` : ""}`,
      `mode: model · facts: ${facts.length} · model: ${modelName}`,
      "",
      modelText.trim(),
      "",
      "---",
      "Heuristic pillars (for cross-check):",
      ...base.pillars.map((p, i) => `${i + 1}. ${p}`),
    ].join("\n");

    const reflection: MemoryReflection = {
      ...base,
      mode: "model",
      summary,
      model: modelName,
      sourceFactIds: facts.map((f) => f.id),
      factCount: facts.length,
    };
    return finalize(cwd, reflection, options.retain);
  } catch {
    return finalize(cwd, base, options.retain);
  }
}

function finalize(
  cwd: string,
  reflection: MemoryReflection,
  retain?: boolean,
): MemoryReflection {
  if (retain && reflection.factCount > 0 && reflection.mode === "model") {
    try {
      // Store a short durable pointer, not the full essay
      const short = reflection.pillars.slice(0, 3).join(" · ").slice(0, 360);
      if (short) {
        retainMemoryFact(cwd, `Reflect summary: ${short}`, {
          tags: ["reflect"],
          importance: 0.7,
          source: "tool",
        });
      }
    } catch {
      // ignore retain failures (secrets guard, disabled, etc.)
    }
  }
  return reflection;
}
