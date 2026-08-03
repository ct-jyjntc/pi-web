/**
 * Project /init — scan a cwd and create or improve AGENTS.md for future agent turns.
 * Single owner for scan + generate + write; API and slash call this module.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { isIgnoredDirentName } from "./file-ignore";

const SCAN_BUDGET_CHARS = 12_000;
const GENERATED_MAX_CHARS = 8_000;
const AI_TIMEOUT_MS = 45_000;
const AI_MAX_TOKENS = 2_400;

const ROOT_DOCS = [
  "README.md",
  "README.zh-CN.md",
  "README",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "Makefile",
];

export type ProjectScanSnapshot = {
  cwd: string;
  topLevel: string[];
  packageJson?: {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: string[];
    devDependencies?: string[];
  };
  lockfiles: string[];
  docs: Array<{ path: string; excerpt: string }>;
  existingAgentsMd: string | null;
  cursorRules: string | null;
  hasGit: boolean;
};

export type ProjectInitResult = {
  ok: true;
  path: string;
  created: boolean;
  source: "ai" | "heuristic";
  preview: string;
  written: boolean;
  bytes: number;
};

export type ProjectInitError = {
  ok: false;
  error: string;
};

function readTextLimited(path: string, max = 4_000): string | null {
  if (!existsSync(path)) return null;
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > 200_000) return null;
    const raw = readFileSync(path, "utf8");
    return raw.length > max ? `${raw.slice(0, max)}\n…(truncated)` : raw;
  } catch {
    return null;
  }
}

function listTopLevel(cwd: string): string[] {
  try {
    return readdirSync(cwd, { withFileTypes: true })
      .filter((d) => !isIgnoredDirentName(d.name) && !d.name.startsWith("."))
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 80);
  } catch {
    return [];
  }
}

function parsePackageJson(cwd: string): ProjectScanSnapshot["packageJson"] | undefined {
  const raw = readTextLimited(join(cwd, "package.json"), 20_000);
  if (!raw) return undefined;
  try {
    const pkg = JSON.parse(raw) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      name: typeof pkg.name === "string" ? pkg.name : undefined,
      scripts: pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : undefined,
      dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 40) : undefined,
      devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 40) : undefined,
    };
  } catch {
    return undefined;
  }
}

const LOCKFILE_NAMES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
];

/** Pure filesystem scan — no model calls. */
export function scanProject(cwd: string): ProjectScanSnapshot {
  const topLevel = listTopLevel(cwd);
  const packageJson = parsePackageJson(cwd);
  const lockfiles = LOCKFILE_NAMES.filter((n) => existsSync(join(cwd, n)));
  const docs: ProjectScanSnapshot["docs"] = [];
  for (const name of ROOT_DOCS) {
    if (name === "AGENTS.md" || name === "package.json") continue;
    const text = readTextLimited(join(cwd, name), 2_500);
    if (text) docs.push({ path: name, excerpt: text });
  }
  // Lightweight .cursor/rules peek
  let cursorRules: string | null = null;
  const cursorPath = join(cwd, ".cursor", "rules");
  if (existsSync(cursorPath)) {
    try {
      const entries = readdirSync(cursorPath).filter((n) => n.endsWith(".md") || n.endsWith(".mdc")).slice(0, 5);
      const bits: string[] = [];
      for (const e of entries) {
        const t = readTextLimited(join(cursorPath, e), 1_200);
        if (t) bits.push(`### ${e}\n${t}`);
      }
      if (bits.length) cursorRules = bits.join("\n\n").slice(0, 4_000);
    } catch {
      cursorRules = null;
    }
  }

  return {
    cwd,
    topLevel,
    packageJson,
    lockfiles,
    docs,
    existingAgentsMd: readTextLimited(join(cwd, "AGENTS.md"), 12_000),
    cursorRules,
    hasGit: existsSync(join(cwd, ".git")),
  };
}

function formatScanForPrompt(scan: ProjectScanSnapshot, focus?: string): string {
  const lines: string[] = [
    `cwd: ${scan.cwd}`,
    `git: ${scan.hasGit ? "yes" : "no"}`,
    `top-level: ${scan.topLevel.join(", ") || "(empty)"}`,
    `lockfiles: ${scan.lockfiles.join(", ") || "(none)"}`,
  ];
  if (scan.packageJson) {
    lines.push(`package name: ${scan.packageJson.name ?? "(unnamed)"}`);
    if (scan.packageJson.scripts) {
      lines.push("npm scripts:");
      for (const [k, v] of Object.entries(scan.packageJson.scripts).slice(0, 30)) {
        lines.push(`  ${k}: ${v}`);
      }
    }
    if (scan.packageJson.dependencies?.length) {
      lines.push(`dependencies: ${scan.packageJson.dependencies.join(", ")}`);
    }
    if (scan.packageJson.devDependencies?.length) {
      lines.push(`devDependencies: ${scan.packageJson.devDependencies.join(", ")}`);
    }
  }
  if (focus?.trim()) lines.push(`user focus: ${focus.trim()}`);
  if (scan.cursorRules) {
    lines.push("", "## Cursor rules excerpts", scan.cursorRules);
  }
  for (const doc of scan.docs) {
    lines.push("", `## ${doc.path}`, doc.excerpt);
  }
  if (scan.existingAgentsMd) {
    lines.push("", "## Existing AGENTS.md", scan.existingAgentsMd);
  }
  let body = lines.join("\n");
  if (body.length > SCAN_BUDGET_CHARS) body = `${body.slice(0, SCAN_BUDGET_CHARS)}\n…(truncated)`;
  return body;
}

function heuristicAgentsMd(scan: ProjectScanSnapshot, focus?: string): string {
  const name = scan.packageJson?.name
    ?? (relative(join(scan.cwd, ".."), scan.cwd) || "project");
  const scripts = scan.packageJson?.scripts ?? {};
  const scriptLines = Object.entries(scripts)
    .slice(0, 20)
    .map(([k, v]) => `- \`${k}\`: \`${v}\``);
  const sections = [
    `# ${name}`,
    "",
    "Guidance for coding agents working in this repository.",
    "",
    "## Commands",
    scriptLines.length > 0 ? scriptLines.join("\n") : "- (add build / lint / test commands here)",
    "",
    "## Layout",
    scan.topLevel.length
      ? scan.topLevel.slice(0, 40).map((e) => `- \`${e}\``).join("\n")
      : "- (top-level entries)",
    "",
    "## Conventions",
    "- Prefer small, focused diffs over large rewrites.",
    "- Run the project's lint/typecheck when available before finishing.",
    "- Do not commit secrets or rewrite lockfiles without a reason.",
  ];
  if (focus?.trim()) {
    sections.push("", "## Focus", focus.trim());
  }
  if (scan.lockfiles.length) {
    sections.push("", "## Package manager", `Detected: ${scan.lockfiles.join(", ")}`);
  }
  sections.push("");
  return sections.join("\n");
}

function sanitizeAgentsMarkdown(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Drop a leading "Here is..." preamble line if present
  const lines = text.split("\n");
  if (lines[0] && /^(here('s| is)|sure[,.]|i('ve| have) (created|updated))/i.test(lines[0].trim())) {
    lines.shift();
    while (lines[0] !== undefined && !lines[0].trim()) lines.shift();
    text = lines.join("\n").trim();
  }
  if (text.length > GENERATED_MAX_CHARS) {
    text = `${text.slice(0, GENERATED_MAX_CHARS)}\n\n<!-- truncated by pi-web /init -->\n`;
  }
  if (!text.endsWith("\n")) text += "\n";
  return text;
}

async function generateWithModel(
  cwd: string,
  scan: ProjectScanSnapshot,
  focus?: string,
): Promise<{ text: string; source: "ai" | "heuristic" }> {
  // Dynamic imports keep pure scan/heuristic paths free of heavy model runtime
  // (also lets unit tests import this module without path-alias resolution).
  const { readWebSettings } = await import("./web-settings");
  const { roleFallbackChain } = await import("./model-roles");
  const { completeWithUtilityModel } = await import("./utility-model");
  const { assistantText } = await import("./message-text");

  const prefs = readWebSettings();
  // smol → plan → default role chain (first non-null wins for utility resolve).
  const preferred =
    roleFallbackChain("smol", prefs).find(Boolean)
    ?? roleFallbackChain("plan", prefs).find(Boolean)
    ?? null;

  const systemPrompt = [
    "You write AGENTS.md files for coding agents (similar to Cursor rules).",
    "Output ONLY the markdown body of AGENTS.md — no fences, no preamble.",
    "Keep it concise (prefer under ~120 lines).",
    "Include when discoverable:",
    "- build / lint / typecheck / test commands and the package manager",
    "- non-obvious architecture and directory map",
    "- project conventions and gotchas",
    "- pointers to existing rules (Cursor, CONTRIBUTING) without duplicating them wholesale",
    "If an existing AGENTS.md is provided, improve it in place: keep useful user content, fix stale bits, do not invent commands that are not in the scan.",
    "Prefer English unless the repo docs are clearly Chinese-only.",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const { response } = await completeWithUtilityModel(
      cwd,
      preferred,
      {
        systemPrompt,
        messages: [{
          role: "user",
          content: [
            "Create or improve AGENTS.md from this project scan:",
            "",
            formatScanForPrompt(scan, focus),
          ].join("\n"),
          timestamp: Date.now(),
        }],
      },
      {
        maxTokens: AI_MAX_TOKENS,
        temperature: 0.2,
        timeoutMs: AI_TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        signal: controller.signal,
      },
    );

    if (response.stopReason === "error" || response.stopReason === "aborted") {
      throw new Error(response.errorMessage ?? "Model failed");
    }
    const text = sanitizeAgentsMarkdown(assistantText(response) ?? "");
    if (!text || text.length < 40) throw new Error("Model returned empty AGENTS.md");
    return { text, source: "ai" };
  } catch {
    return { text: heuristicAgentsMd(scan, focus), source: "heuristic" };
  } finally {
    clearTimeout(timeout);
  }
}

export type RunProjectInitOptions = {
  /** When true, only return markdown; do not write AGENTS.md. */
  dryRun?: boolean;
  focus?: string;
  /** Prefer heuristic only (tests / offline). */
  heuristicOnly?: boolean;
};

/**
 * Scan + generate AGENTS.md at `<cwd>/AGENTS.md`.
 */
export async function runProjectInit(
  cwd: string,
  options: RunProjectInitOptions = {},
): Promise<ProjectInitResult | ProjectInitError> {
  if (!cwd || !existsSync(cwd)) {
    return { ok: false, error: "cwd does not exist" };
  }
  try {
    if (!statSync(cwd).isDirectory()) {
      return { ok: false, error: "cwd is not a directory" };
    }
  } catch {
    return { ok: false, error: "cwd is not accessible" };
  }

  const scan = scanProject(cwd);
  const hadExisting = Boolean(scan.existingAgentsMd);
  const generated = options.heuristicOnly
    ? { text: heuristicAgentsMd(scan, options.focus), source: "heuristic" as const }
    : await generateWithModel(cwd, scan, options.focus);

  const path = join(cwd, "AGENTS.md");
  if (!options.dryRun) {
    writeFileSync(path, generated.text, "utf8");
  }

  return {
    ok: true,
    path,
    created: !hadExisting,
    source: generated.source,
    preview: generated.text,
    written: !options.dryRun,
    bytes: Buffer.byteLength(generated.text, "utf8"),
  };
}
