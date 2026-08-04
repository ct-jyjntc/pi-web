/**
 * Per-mode briefing delivered to the model as a hidden custom message.
 *
 * Stripping edit/write from the tool list tells the *runtime* that plan mode is
 * read-only, but nothing told the *model* — it would reach for edit, get a tool
 * error, and improvise. The brief closes that gap, and also covers the hole the
 * tool filter cannot: bash is still available in plan mode (a plan needs to read
 * files and run `git log`), so the no-mutation rule has to be stated.
 */
import type { AgentMode } from "./agent-mode";

const PLAN_BRIEF = [
  "You are in PLAN mode.",
  "",
  "- The `edit` and `write` tools are disabled. Do not attempt them.",
  "- Do not mutate the workspace by other means either: no shell redirection,",
  "  `sed -i`, `git apply`, `mv`/`rm`, package installs, or migrations.",
  "- Read, search, and run read-only commands as much as you need.",
  "- Finish by presenting a concrete plan: the files you would change, what the",
  "  change is, and anything still unresolved.",
  "- Wait for the user to approve and switch modes before implementing.",
].join("\n");

/** The brief for `mode`, or null when the mode needs no extra instruction. */
export function agentModeBrief(mode: AgentMode): string | null {
  return mode === "plan" ? PLAN_BRIEF : null;
}
