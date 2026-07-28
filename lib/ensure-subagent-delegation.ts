import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Subagent delegation assets (auto-deployed into ~/.pi/agent on boot).
 *
 * Why this exists: @gotgenes/pi-subagents ships a neutral tool description
 * ("Launch a new agent to handle complex, multi-step tasks autonomously") with
 * usage guidelines that explain *how* to spawn agents but never *when* to prefer
 * them. Models therefore treat the subagent tool as opt-in and only use it when
 * the user explicitly asks. Claude Code feels "smarter" purely because its Task
 * tool description + system prompt aggressively push proactive delegation.
 *
 * This module closes the gap without patching the npm package (which would be
 * overwritten on upgrade):
 *
 *  1. A managed block in the global ~/.pi/agent/AGENTS.md instructs every
 *     session to delegate proactively (loaded by both the pi CLI and Pi Web,
 *     since Pi Web uses the default resource loader).
 *  2. Agent overrides in ~/.pi/agent/agents/*.md replace the built-in
 *     general-purpose / Explore / Plan descriptions with proactive trigger
 *     language. These descriptions are inlined into the subagent tool's own
 *     description ("Available agent types" list) — the highest-signal location
 *     when the model decides whether to call the tool.
 *
 * Both mechanisms are idempotent and respect user customization:
 *  - The AGENTS.md block lives between marker comments; content outside the
 *    markers is never touched. The block is replaced in place when our shipped
 *    text changes (upgrade path).
 *  - Agent override files carry a `pi_web_managed` frontmatter key. Files
 *    without that key are treated as user-owned and never overwritten.
 */

// ── Managed block markers ────────────────────────────────────────────────────

const AGENTS_BLOCK_START = "<!-- pi-web:subagent-delegation:start -->";
const AGENTS_BLOCK_END = "<!-- pi-web:subagent-delegation:end -->";

/** Frontmatter key marking an agent file as managed by pi-web (safe to upgrade). */
const MANAGED_KEY = "pi_web_managed";

// ── AGENTS.md policy block ───────────────────────────────────────────────────

const SUBAGENT_POLICY_BLOCK = `${AGENTS_BLOCK_START}
## Subagent Delegation Policy

Use the \`subagent\` tool PROACTIVELY — do not wait for the user to ask for subagents.

Spawn a subagent whenever any of these apply:

- Exploring or understanding code across multiple files → \`Explore\` (spawn several in the background for independent areas).
- Complex, multi-step work — new features, refactors, or bugfixes touching 3+ files → \`general-purpose\`.
- Architecture or implementation planning → \`Plan\`.
- Several independent subtasks → launch multiple subagents with \`run_in_background: true\` in parallel.

Rules:

- The main loop orchestrates, reviews, and summarizes; delegate heavy reading, searching, and implementation to subagents.
- Give each subagent a complete, self-contained prompt — it does not see this conversation unless \`inherit_context: true\`.
- Prefer delegating over doing everything inline. When in doubt, delegate.
${AGENTS_BLOCK_END}`;

// ── Agent override files ─────────────────────────────────────────────────────
//
// Each override replaces the whole embedded default config (same filename =
// same agent name), so tools / model / prompt_mode / system prompt body must
// restate the original semantics — only the descriptions change. The Explore
// and Plan system prompts below are verbatim copies of the package defaults.

const GENERAL_PURPOSE_MD = `---
display_name: Agent
description: >-
  General-purpose agent for complex, multi-step tasks. USE PROACTIVELY: if a
  task involves reading or editing 3+ files, multi-step refactors, new features,
  or non-trivial bugfixes, DELEGATE to this agent instead of doing everything in
  the main loop.
${MANAGED_KEY}: true
---

You are a general-purpose subagent working on behalf of a parent agent.

- Work autonomously until the task is fully done — do not stop at analysis or suggestions.
- Verify your changes before finishing (typecheck / tests / lint) when the project provides them.
- End with a concise report: what changed, key file paths, and anything the parent agent must know.
`;

const EXPLORE_MD = `---
display_name: Explore
description: >-
  Fast codebase exploration agent (read-only). USE PROACTIVELY for any question
  about how code works, where something is defined, or which files are involved —
  spawn one or more Explore agents in the background instead of searching
  file-by-file in the main loop.
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5-20251001
prompt_mode: replace
${MANAGED_KEY}: true
---

# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a file search specialist. You excel at thoroughly navigating and exploring codebases.
Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Use Bash ONLY for read-only operations: ls, git status, git log, git diff, find, cat, head, tail.

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations
- Make independent tool calls in parallel for efficiency
- Adapt search approach based on thoroughness level specified

# Output
- Use absolute file paths in all references
- Report findings as regular messages
- Do not use emojis
- Be thorough and precise
`;

const PLAN_MD = `---
display_name: Plan
description: >-
  Software architect for implementation planning (read-only). USE PROACTIVELY
  before any non-trivial implementation — new features, refactors, or changes
  with unclear scope — to produce a step-by-step plan the main loop can execute.
tools: read, bash, grep, find, ls
prompt_mode: replace
${MANAGED_KEY}: true
---

# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a software architect and planning specialist.
Your role is EXCLUSIVELY to explore the codebase and design implementation plans.
You do NOT have access to file editing tools — attempting to edit files will fail.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

# Planning Process
1. Understand requirements
2. Explore thoroughly (read files, find patterns, understand architecture)
3. Design solution based on your assigned perspective
4. Detail the plan with step-by-step implementation strategy

# Requirements
- Consider trade-offs and architectural decisions
- Identify dependencies and sequencing
- Anticipate potential challenges
- Follow existing patterns where appropriate

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations

# Output Format
- Use absolute file paths
- Do not use emojis
- End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- /absolute/path/to/file.ts - [Brief reason]
`;

const MANAGED_AGENT_FILES: ReadonlyArray<{ filename: string; content: string }> = [
  { filename: "general-purpose.md", content: GENERAL_PURPOSE_MD },
  { filename: "Explore.md", content: EXPLORE_MD },
  { filename: "Plan.md", content: PLAN_MD },
];

// ── Internals ────────────────────────────────────────────────────────────────

function ensureAgentsMdPolicy(agentsMdPath: string): string | null {
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, `${SUBAGENT_POLICY_BLOCK}\n`, "utf8");
    return "Created ~/.pi/agent/AGENTS.md with subagent delegation policy";
  }

  const existing = readFileSync(agentsMdPath, "utf8");
  const startIdx = existing.indexOf(AGENTS_BLOCK_START);
  const endIdx = existing.indexOf(AGENTS_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Managed block present — replace in place if our shipped text changed.
    const current = existing.slice(startIdx, endIdx + AGENTS_BLOCK_END.length);
    if (current === SUBAGENT_POLICY_BLOCK) return null;
    const next = existing.slice(0, startIdx) + SUBAGENT_POLICY_BLOCK + existing.slice(endIdx + AGENTS_BLOCK_END.length);
    writeFileSync(agentsMdPath, next, "utf8");
    return "Updated subagent delegation policy in ~/.pi/agent/AGENTS.md";
  }

  // No managed block — append, preserving all user content.
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(agentsMdPath, `${existing}${separator}${SUBAGENT_POLICY_BLOCK}\n`, "utf8");
  return "Appended subagent delegation policy to ~/.pi/agent/AGENTS.md";
}

function ensureAgentOverride(agentsDir: string, filename: string, content: string): string | null {
  const filePath = join(agentsDir, filename);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, "utf8");
    return `Deployed agent override ${filename}`;
  }

  const existing = readFileSync(filePath, "utf8");
  if (existing === content) return null;

  // Only overwrite files we deployed earlier (marked with the managed key).
  // Unmarked files are user customizations — leave them alone.
  if (!existing.includes(`${MANAGED_KEY}:`)) {
    return `Skipped ${filename} — user-managed agent file detected`;
  }

  writeFileSync(filePath, content, "utf8");
  return `Updated agent override ${filename}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

let done = false;

/**
 * Deploy subagent delegation assets into ~/.pi/agent. Synchronous, idempotent,
 * and never throws — safe to call from instrumentation on every boot.
 */
export function ensureSubagentDelegation(): string[] {
  if (done) return [];
  done = true;

  const notes: string[] = [];
  try {
    const agentDir = getAgentDir();
    mkdirSync(agentDir, { recursive: true });

    const note = ensureAgentsMdPolicy(join(agentDir, "AGENTS.md"));
    if (note) notes.push(note);

    const agentsDir = join(agentDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const { filename, content } of MANAGED_AGENT_FILES) {
      const fileNote = ensureAgentOverride(agentsDir, filename, content);
      if (fileNote) notes.push(fileNote);
    }
  } catch (error) {
    notes.push(
      `ensureSubagentDelegation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("[pi-web]", notes[notes.length - 1]);
  }
  return notes;
}
