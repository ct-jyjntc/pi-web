/**
 * Portable Lean Mode policy text for system-prompt append.
 * Intensity-modulated; product-user facing (not Pi-Web hot-path trivia).
 */
import type { LeanIntensity } from "./lean-mode-settings";

const CORE_RULES = [
  "1. **No stacked recovery** — If a failure mode already has retry / fallback / poll / reconcile / grace, merge or replace that path before adding another.",
  "2. **No nameless swallow** — Do not fix bugs only by widening try/catch, blind optional chaining, or ignoring errors. Name the invariant that failed.",
  "3. **Single owner** — One module owns each semantic; UI / hook / API / service call it instead of reimplementing.",
  "4. **Prefer delete or merge over new guards** when both would silence the same symptom.",
  "5. **No dual-path without an exit** — classic+new or compat shims need an explicit removal condition in the change notes.",
  "6. **Size discipline** — On already-large files, extract first; do not grow them with another pile of guards.",
  "7. **Self-check before finishing** (when this turn edited code, answer briefly in the final reply):",
  "   - Invariant protected or fixed?",
  "   - Single owner module?",
  "   - Recovery path count (which path number is this)?",
  "   - Dual-path? (no | yes + removal condition)",
].join("\n");

/**
 * Build lean policy markdown for appendSystemPromptOverride.
 * Empty string is never returned for a valid intensity — caller gates on enabled.
 */
export function buildLeanPolicyText(intensity: LeanIntensity): string {
  const header = [
    "## Lean Mode (Pi Web)",
    "",
    "Keep the codebase lean. Prefer clean ownership and one recovery path over defensive patch piles.",
    "",
    "### Rules",
    CORE_RULES,
  ];

  if (intensity === "soft") {
    return [
      ...header,
      "",
      "### Tone",
      "Follow these rules when practical. Prefer smaller, clearer diffs over belt-and-suspenders fixes.",
    ].join("\n");
  }

  if (intensity === "hard") {
    return [
      ...header,
      "",
      "### Hard intensity (MUST)",
      "- You **MUST** obey the rules above. A patch-style stack without naming the invariant is **unfinished**.",
      "- You **MUST NOT** add a second recovery path for a failure that already has one.",
      "- You **MUST NOT** land dual implementations without a removal condition.",
      "- You **MUST** complete the self-check in the final reply when files changed.",
    ].join("\n");
  }

  // review (default when enabled)
  return [
    ...header,
    "",
    "### Review",
    "After turns that edit files, apply these rules strictly: keep diffs minimal, name the invariant you fixed,",
    "keep a single owner for each semantic, and extract a module before growing an already-large file.",
    "When you fix a failure, state the invariant and the recovery path count in your reply.",
  ].join("\n");
}