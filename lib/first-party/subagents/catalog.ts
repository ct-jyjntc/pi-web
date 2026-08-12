/**
 * Load native subagent types from ~/.pi/agent/agents and <cwd>/.pi/agents.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "../../agent-dir";
import {
  FULL_CODING_TOOLS,
  READ_ONLY_TOOLS,
  type AgentTypeConfig,
} from "./types";

const READ_ONLY_PROMPT = `# READ-ONLY
You may only search and analyze existing files. Do not create, edit, or delete files.
Use bash only for read-only commands (ls, git status, git log, git diff, find).
End with a concise report and absolute file paths.`;

export const FALLBACK_AGENT_TYPES: AgentTypeConfig[] = [
  {
    name: "general-purpose",
    displayName: "Agent",
    description: "General-purpose agent for complex, multi-step work.",
    tools: [...FULL_CODING_TOOLS],
    systemPrompt: "You are a general-purpose subagent. Finish the task. Verify when possible. End with a concise report.",
    promptMode: "append",
    enabled: true,
  },
  {
    name: "Explore",
    displayName: "Explore",
    description: "Fast read-only codebase exploration.",
    tools: [...READ_ONLY_TOOLS],
    systemPrompt: READ_ONLY_PROMPT,
    promptMode: "replace",
    enabled: true,
  },
  {
    name: "Plan",
    displayName: "Plan",
    description: "Read-only implementation planning.",
    tools: [...READ_ONLY_TOOLS],
    systemPrompt: `${READ_ONLY_PROMPT}\n\nProduce a step-by-step plan the parent can execute.`,
    promptMode: "replace",
    enabled: true,
  },
  {
    name: "Reviewer",
    displayName: "Reviewer",
    description: "Read-only git/patch review.",
    tools: [...READ_ONLY_TOOLS],
    systemPrompt: `${READ_ONLY_PROMPT}\n\nReport only issues introduced by the change, with P0–P3 priority.`,
    promptMode: "replace",
    enabled: true,
  },
];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTools(value: unknown, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).trim();
  if (!raw || raw === "none") return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

function loadDir(dir: string, into: Map<string, AgentTypeConfig>): void {
  if (!existsSync(dir)) return;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return;
  }
  for (const file of files) {
    const name = basename(file, ".md");
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(content);
    const fallback = FALLBACK_AGENT_TYPES.find((item) => item.name === name);
    const toolsDefault = fallback?.tools ?? [...FULL_CODING_TOOLS];
    into.set(name, {
      name,
      displayName: asString(frontmatter.display_name) ?? name,
      description: asString(frontmatter.description) ?? name,
      tools: parseTools(frontmatter.tools, toolsDefault),
      systemPrompt: body.trim() || fallback?.systemPrompt || "",
      promptMode: frontmatter.prompt_mode === "replace" ? "replace" : "append",
      model: asString(frontmatter.model),
      thinking: asString(frontmatter.thinking),
      maxTurns: typeof frontmatter.max_turns === "number" ? frontmatter.max_turns : undefined,
      enabled: frontmatter.enabled !== false,
    });
  }
}

export function loadAgentTypes(cwd: string): Map<string, AgentTypeConfig> {
  const types = new Map<string, AgentTypeConfig>();
  for (const fallback of FALLBACK_AGENT_TYPES) types.set(fallback.name, fallback);
  loadDir(join(getAgentDir(), "agents"), types);
  if (cwd) loadDir(join(cwd, ".pi", "agents"), types);
  return types;
}

export function resolveAgentType(
  requested: string | undefined,
  types: Map<string, AgentTypeConfig>,
): { type: AgentTypeConfig; note?: string } {
  const general = types.get("general-purpose") ?? FALLBACK_AGENT_TYPES[0]!;
  if (!requested) return { type: general, note: "No subagent_type — using general-purpose." };
  const exact = types.get(requested);
  if (exact) {
    if (exact.enabled === false) {
      return { type: general, note: `Agent type "${requested}" is disabled — using general-purpose.` };
    }
    return { type: exact };
  }
  const lower = requested.toLowerCase();
  for (const [name, type] of types) {
    if (name.toLowerCase() === lower) {
      if (type.enabled === false) {
        return { type: general, note: `Agent type "${requested}" is disabled — using general-purpose.` };
      }
      return { type };
    }
  }
  return { type: general, note: `Unknown agent type "${requested}" — using general-purpose.` };
}

export function listEnabledTypeNames(types: Map<string, AgentTypeConfig>): string[] {
  return [...types.values()].filter((type) => type.enabled !== false).map((type) => type.name);
}
