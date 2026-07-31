import path from "path";
import {
  commitGitChanges,
  getCommitDiffContext,
  getGitStatus,
  stageGitFiles,
  unstageGitFiles,
} from "./git-changes";
import type { GitStatusResponse } from "./git-types";
import { assistantText } from "./message-text";
import { completeWithUtilityModel } from "./utility-model";
import { readWebSettings } from "./web-settings";

export type CommitSplitGroup = {
  id: string;
  title: string;
  message: string;
  paths: string[];
  rationale?: string;
};

export type CommitSplitPlan = {
  groups: CommitSplitGroup[];
  unassigned: string[];
  source: "ai" | "heuristic";
};

export type CommitSplitResult = {
  commits: Array<{ commit: string | null; message: string; paths: string[] }>;
  status: GitStatusResponse;
};

function sanitizeSubject(raw: string): string {
  let text = raw.trim().replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim();
  text = text.replace(/^(?:commit message|message)\s*:\s*/i, "").trim();
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.replace(/\s+/g, " ").slice(0, 72);
}

function changedAbsolutePaths(status: GitStatusResponse, includeUnstaged: boolean): string[] {
  return status.files
    .filter((f) => f.status !== "conflict" && (f.staged || (includeUnstaged && f.unstaged)))
    .map((f) => f.filePath);
}

function topBucket(filePath: string, repositoryRoot: string | null): string {
  const rel = repositoryRoot
    ? path.relative(repositoryRoot, filePath).split(path.sep).join("/")
    : filePath;
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  const base = parts[parts.length - 1] ?? "file";
  if (/\.(test|spec)\.[^.]+$/i.test(base) || parts.includes("__tests__") || parts.includes("tests")) {
    return "tests";
  }
  if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb)$/i.test(base)) {
    return "lockfile";
  }
  if (/^(README|CHANGELOG|LICENSE)/i.test(base) || parts[0] === "docs") {
    return "docs";
  }
  if (parts[0] === "lib" || parts[0] === "src" || parts[0] === "app" || parts[0] === "components") {
    return parts[0]!;
  }
  return parts[0] ?? "root";
}

function heuristicPlan(
  paths: string[],
  repositoryRoot: string | null,
): CommitSplitPlan {
  const buckets = new Map<string, string[]>();
  for (const p of paths) {
    // Skip lockfiles from primary analysis buckets — attach later or leave unassigned
    const name = path.basename(p);
    if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb)$/i.test(name)) {
      continue;
    }
    const key = topBucket(p, repositoryRoot);
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }

  const order = ["app", "components", "lib", "src", "tests", "docs"];
  const keys = [
    ...order.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => !order.includes(k)).sort(),
  ];

  const groups: CommitSplitGroup[] = keys.map((key, i) => {
    const groupPaths = buckets.get(key) ?? [];
    const title =
      key === "tests" ? "test: update tests"
        : key === "docs" ? "docs: update documentation"
          : key === "lib" || key === "src" || key === "app" || key === "components"
            ? `refactor: update ${key}`
            : `chore: update ${key}`;
    return {
      id: `g${i + 1}`,
      title,
      message: title,
      paths: groupPaths,
      rationale: `Grouped by ${key}`,
    };
  }).filter((g) => g.paths.length > 0);

  const assigned = new Set(groups.flatMap((g) => g.paths));
  const unassigned = paths.filter((p) => !assigned.has(p));
  return { groups, unassigned, source: "heuristic" };
}

function parseAiGroups(raw: string, allowed: Set<string>): CommitSplitGroup[] {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI did not return JSON");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { groups?: unknown };
  if (!Array.isArray(parsed.groups)) throw new Error("AI JSON missing groups");

  const groups: CommitSplitGroup[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const item of parsed.groups) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const message = sanitizeSubject(String(g.message ?? g.title ?? ""));
    if (!message) continue;
    const pathsRaw = Array.isArray(g.paths) ? g.paths.map(String) : [];
    const paths = pathsRaw.filter((p) => allowed.has(p) && !seen.has(p));
    for (const p of paths) seen.add(p);
    if (paths.length === 0) continue;
    i += 1;
    groups.push({
      id: typeof g.id === "string" ? g.id : `g${i}`,
      title: message,
      message,
      paths,
      rationale: typeof g.rationale === "string" ? g.rationale : undefined,
    });
  }
  return groups;
}

export async function planAtomicCommits(
  cwd: string,
  options?: { includeUnstaged?: boolean; preferAi?: boolean },
): Promise<CommitSplitPlan> {
  const includeUnstaged = options?.includeUnstaged !== false;
  const status = await getGitStatus(cwd);
  if (!status.isGitRepository) throw new Error("Not a git repository");
  if (status.conflictCount > 0) {
    throw new Error("Resolve merge conflicts before splitting commits");
  }

  const paths = changedAbsolutePaths(status, includeUnstaged);
  if (paths.length === 0) throw new Error("No changes to split");

  // Single file → one commit plan
  if (paths.length === 1) {
    return {
      groups: [{
        id: "g1",
        title: "chore: update file",
        message: "chore: update file",
        paths,
        rationale: "Single changed file",
      }],
      unassigned: [],
      source: "heuristic",
    };
  }

  if (options?.preferAi === false) {
    return heuristicPlan(paths, status.repositoryRoot);
  }

  try {
    const context = await getCommitDiffContext(cwd, {
      includeUnstaged,
      maxChars: 35_000,
    });
    const prefs = readWebSettings();
    const preferred = prefs.commitModel ?? prefs.modelRoles.smol ?? prefs.modelRoles.default;
    const pathList = paths.join("\n");
    const { response } = await completeWithUtilityModel(cwd, preferred, {
      systemPrompt: [
        "You split a dirty git working tree into atomic commits.",
        "Return ONLY JSON:",
        '{ "groups": [ { "id": "g1", "message": "feat: ...", "paths": ["/abs/path"], "rationale": "..." } ] }',
        "Rules:",
        "- paths must be a subset of the provided absolute paths",
        "- each path in at most one group",
        "- prefer source changes before tests/docs",
        "- exclude lockfiles from groups when possible",
        "- 2–6 groups max; merge tiny related files",
        "- message: imperative subject ≤72 chars, optional conventional prefix",
      ].join("\n"),
      messages: [{
        role: "user",
        content: [
          "Absolute paths:",
          pathList,
          "",
          "Diff summary:",
          context.summary,
        ].join("\n"),
        timestamp: Date.now(),
      }],
    }, {
      maxTokens: 1200,
      temperature: 0.2,
      timeoutMs: 45_000,
      maxRetries: 0,
      cacheRetention: "none",
    });

    if (response.stopReason === "error" || response.stopReason === "aborted") {
      throw new Error(response.errorMessage ?? "AI split failed");
    }

    const allowed = new Set(paths);
    const groups = parseAiGroups(assistantText(response), allowed);
    if (groups.length === 0) throw new Error("AI returned no valid groups");
    const assigned = new Set(groups.flatMap((g) => g.paths));
    const unassigned = paths.filter((p) => !assigned.has(p));
    return { groups, unassigned, source: "ai" };
  } catch {
    return heuristicPlan(paths, status.repositoryRoot);
  }
}

export async function executeAtomicCommits(
  cwd: string,
  groups: Array<{ message: string; paths: string[] }>,
): Promise<CommitSplitResult> {
  const status0 = await getGitStatus(cwd);
  if (!status0.isGitRepository) throw new Error("Not a git repository");
  if (status0.conflictCount > 0) {
    throw new Error("Resolve merge conflicts before committing");
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("No commit groups provided");
  }

  const allowed = new Set(
    status0.files.filter((f) => f.status !== "conflict").map((f) => path.resolve(f.filePath)),
  );

  // Normalize + validate
  const normalized = groups.map((g, i) => {
    const message = sanitizeSubject(g.message);
    if (!message) throw new Error(`Group ${i + 1}: message required`);
    const paths = (g.paths ?? []).map((p) => path.resolve(p));
    if (paths.length === 0) throw new Error(`Group ${i + 1}: paths required`);
    for (const p of paths) {
      if (!allowed.has(p)) throw new Error(`Path not in current changes: ${p}`);
    }
    return { message, paths };
  });

  // Unstage everything we will re-stage in groups (best effort)
  const allTarget = [...new Set(normalized.flatMap((g) => g.paths))];
  try {
    await unstageGitFiles(cwd, allTarget);
  } catch {
    // may fail if nothing staged
  }

  const commits: CommitSplitResult["commits"] = [];
  for (const group of normalized) {
    await stageGitFiles(cwd, group.paths);
    const { commit, status } = await commitGitChanges(cwd, group.message);
    commits.push({ commit, message: group.message, paths: group.paths });
    // continue with remaining
    void status;
  }

  return {
    commits,
    status: await getGitStatus(cwd),
  };
}
