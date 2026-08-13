import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./agent-dir";
import { formatRoleModelForAgent } from "./model-roles";
import { readWebSettings, type WebSettings } from "./web-settings";

/**
 * Subagent type files (auto-deployed into ~/.pi/agent on boot).
 *
 * Native Pi Web subagents read these markdown files for Explore / Plan /
 * Reviewer / general-purpose. The AGENTS.md block tells the parent model
 * when to delegate.
 * This module only writes those files. The native factory in
 * lib/first-party/subagents reads them at spawn time.
 *
 *  1. A managed block in ~/.pi/agent/AGENTS.md tells the parent to delegate.
 *  2. Agent files in ~/.pi/agent/agents/*.md supply Explore / Plan / Reviewer /
 *     general-purpose prompts and tool allow-lists.
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
- Git / patch code review (Git Review button or explicit review request) → \`Reviewer\`.
- Several independent subtasks → launch multiple subagents with \`run_in_background: true\` in parallel.

Rules:

- The main loop orchestrates, reviews, and summarizes; delegate heavy reading, searching, and implementation to subagents.
- Give each subagent a complete, self-contained prompt — it does not see this conversation.
- Prefer delegating over doing everything inline. When in doubt, delegate.
- \`run_in_background\` only unblocks that tool call so you can launch several in parallel. Call \`get_subagent_result\` with \`wait: true\` when you need a result mid-turn. Do not write the final user-facing answer until results are in — if you stop early, the runtime delivers uncollected results and continues the turn.
${AGENTS_BLOCK_END}`;

// ── Agent override files ─────────────────────────────────────────────────────

function modelFrontmatterLine(modelRef: string | null): string {
  // Omit model when unset so the subagent inherits the parent session model.
  return modelRef ? `model: ${modelRef}\n` : "";
}

function buildGeneralPurposeMd(): string {
  return `---
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
}

function buildExploreMd(smolModel: string | null): string {
  return `---
display_name: Explore
description: >-
  Fast codebase exploration agent (read-only). USE PROACTIVELY for any question
  about how code works, where something is defined, or which files are involved —
  spawn one or more Explore agents in the background instead of searching
  file-by-file in the main loop.
tools: read, bash, grep, find, ls
${modelFrontmatterLine(smolModel)}prompt_mode: replace
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
}

function buildPlanMd(planModel: string | null): string {
  return `---
display_name: Plan
description: >-
  Software architect for implementation planning (read-only). USE PROACTIVELY
  before any non-trivial implementation — new features, refactors, or changes
  with unclear scope — to produce a step-by-step plan the main loop can execute.
tools: read, bash, grep, find, ls
${modelFrontmatterLine(planModel)}prompt_mode: replace
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
}

function buildReviewerMd(planModel: string | null): string {
  return `---
display_name: Reviewer
description: >-
  Code review specialist. USE for git/patch review requests and the Git Review
  workflow. Read-only. Report only bugs introduced by the patch with P0–P3
  priority and a final verdict.
tools: read, bash, grep, find, ls
${modelFrontmatterLine(planModel)}prompt_mode: replace
${MANAGED_KEY}: true
---

# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a careful code reviewer. Your job is to review a patch / working tree
diff and report only issues with provable impact that were introduced by the
change under review.

You are STRICTLY PROHIBITED from:
- Creating, modifying, deleting, or moving files
- Staging, committing, pushing, or rewriting git history
- Running package installs or any command that changes system state
- Using redirect operators to write files

Bash is allowed only for read-only git inspection: git status, git diff, git log,
git show, git rev-parse, git blame.

# Review criteria
- Report only issues introduced by the patch (not pre-existing debt unless the
  patch makes it worse in a concrete way).
- Every finding must be actionable and tied to a file/line when possible.
- Prefer fewer high-signal findings over a wall of nits.

# Priority scale
- P0 — blocks release / correctness / security / data loss
- P1 — serious bug or regression likely to hit users soon
- P2 — moderate issue worth fixing before merge
- P3 — nit / style / minor suggestion

# Output format
Write a short human-readable summary first, then end your response with ONE
fenced JSON block (and nothing after it). Use this schema EXACTLY — do not rename fields:

\`\`\`json
{
  "overall_correctness": "correct" | "incorrect",
  "explanation": "1-3 sentences",
  "confidence": 0.0,
  "findings": [
    {
      "title": "short title",
      "body": "what is wrong and why it matters",
      "priority": "P0" | "P1" | "P2" | "P3",
      "confidence": 0.0,
      "file_path": "/absolute/path",
      "line_start": 1,
      "line_end": 1
    }
  ]
}
\`\`\`

Hard rules for the JSON:
- overall_correctness MUST be exactly "correct" or "incorrect" (never needs_fix/pass/fail)
- Use title + body + file_path + line_start (not message/file/line/summary aliases)
- overall_correctness is "incorrect" if any P0/P1 exists, else usually "correct"
- findings may be an empty array
- confidence values are 0–1
- Prefer absolute file paths; omit file_path / line fields when unknown
`;
}

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
    const current = existing.slice(startIdx, endIdx + AGENTS_BLOCK_END.length);
    if (current === SUBAGENT_POLICY_BLOCK) return null;
    const next = existing.slice(0, startIdx) + SUBAGENT_POLICY_BLOCK + existing.slice(endIdx + AGENTS_BLOCK_END.length);
    writeFileSync(agentsMdPath, next, "utf8");
    return "Updated subagent delegation policy in ~/.pi/agent/AGENTS.md";
  }

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

  if (!existing.includes(`${MANAGED_KEY}:`)) {
    return `Skipped ${filename} — user-managed agent file detected`;
  }

  writeFileSync(filePath, content, "utf8");
  return `Updated agent override ${filename}`;
}

function managedAgentFiles(settings: WebSettings): Array<{ filename: string; content: string }> {
  const smol = formatRoleModelForAgent("smol", settings);
  const plan = formatRoleModelForAgent("plan", settings);
  return [
    { filename: "general-purpose.md", content: buildGeneralPurposeMd() },
    { filename: "Explore.md", content: buildExploreMd(smol) },
    { filename: "Plan.md", content: buildPlanMd(plan) },
    { filename: "Reviewer.md", content: buildReviewerMd(plan) },
  ];
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
    const settings = readWebSettings();
    for (const { filename, content } of managedAgentFiles(settings)) {
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

/**
 * Re-sync managed Explore/Plan/Reviewer model frontmatter from web settings.
 * Safe to call after Settings role changes; never throws.
 */
export function syncAgentModelsFromRoles(settings?: WebSettings): string[] {
  const notes: string[] = [];
  try {
    const agentDir = getAgentDir();
    const agentsDir = join(agentDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    const prefs = settings ?? readWebSettings();
    for (const { filename, content } of managedAgentFiles(prefs)) {
      const fileNote = ensureAgentOverride(agentsDir, filename, content);
      if (fileNote) notes.push(fileNote);
    }
  } catch (error) {
    notes.push(
      `syncAgentModelsFromRoles failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("[pi-web]", notes[notes.length - 1]);
  }
  return notes;
}
