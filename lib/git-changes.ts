import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";
import { gitProcessEnv, resolveGitBinary } from "./resolve-git";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_NETWORK_TIMEOUT_MS = 120_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
  timeout = GIT_TIMEOUT_MS,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), ["-C", cwd, ...args], {
      timeout,
      maxBuffer,
      env: gitProcessEnv(),
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "";
    const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "";
    throw new Error((stderr || stdout || err.message || "git failed").trim());
  }
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

function realPath(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

function isWithinPath(parent: string, target: string): boolean {
  // realpath so macOS /var → /private/var (and similar) still counts as inside.
  const relative = path.relative(realPath(parent), realPath(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

function isStaged(entry: GitPorcelainEntry): boolean {
  return entry.indexStatus !== " " && entry.indexStatus !== "?";
}

function isUnstaged(entry: GitPorcelainEntry): boolean {
  // worktreeStatus is " " when clean; "?" for untracked (??) and letter codes for edits.
  // (Do not add `=== "?"` after a `!== " "` check — TS narrows worktree to " " on the RHS.)
  return entry.worktreeStatus !== " ";
}

async function readBranch(repositoryRoot: string): Promise<string | null> {
  try {
    const name = (await git(repositoryRoot, ["branch", "--show-current"])).trim();
    if (name) return name;
  } catch {
    // fall through
  }
  try {
    const short = (await git(repositoryRoot, ["rev-parse", "--short", "HEAD"])).trim();
    return short ? `detached@${short}` : null;
  } catch {
    return null;
  }
}

async function readUpstreamTracking(repositoryRoot: string): Promise<{ upstream: string | null; ahead: number; behind: number }> {
  try {
    const upstream = (await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"])).trim();
    if (!upstream || upstream === "@{{upstream}}") {
      return { upstream: null, ahead: 0, behind: 0 };
    }
    try {
      const counts = (await git(repositoryRoot, ["rev-list", "--left-right", "--count", `@{upstream}...HEAD`])).trim();
      const [behindRaw, aheadRaw] = counts.split(/\s+/);
      return {
        upstream,
        ahead: Number.parseInt(aheadRaw ?? "0", 10) || 0,
        behind: Number.parseInt(behindRaw ?? "0", 10) || 0,
      };
    } catch {
      return { upstream, ahead: 0, behind: 0 };
    }
  } catch {
    return { upstream: null, ahead: 0, behind: 0 };
  }
}

async function readNumstatMap(repositoryRoot: string): Promise<Map<string, { insertions: number; deletions: number }>> {
  const map = new Map<string, { insertions: number; deletions: number }>();
  const merge = (text: string) => {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const ins = parts[0] === "-" ? 0 : Number.parseInt(parts[0], 10) || 0;
      const del = parts[1] === "-" ? 0 : Number.parseInt(parts[1], 10) || 0;
      // rename lines: old => new — take last path segment field
      const fileField = parts[parts.length - 1] ?? "";
      const gitPath = fileField.includes(" => ")
        ? fileField.split(" => ").pop()!.trim()
        : fileField.trim();
      if (!gitPath) continue;
      const prev = map.get(gitPath) ?? { insertions: 0, deletions: 0 };
      map.set(gitPath, { insertions: prev.insertions + ins, deletions: prev.deletions + del });
    }
  };
  try {
    merge(await git(repositoryRoot, ["diff", "--numstat", "HEAD"]));
  } catch {
    // no HEAD yet
  }
  try {
    merge(await git(repositoryRoot, ["diff", "--cached", "--numstat"]));
  } catch {
    // ignore
  }
  // untracked files: count lines as insertions
  try {
    const untracked = (await git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]))
      .split("\0")
      .filter(Boolean);
    for (const rel of untracked) {
      if (map.has(rel)) continue;
      try {
        const abs = path.resolve(repositoryRoot, rel);
        const buf = fs.readFileSync(abs);
        if (buf.includes(0) || buf.length > TEXT_PREVIEW_MAX_BYTES) {
          map.set(rel, { insertions: 0, deletions: 0 });
          continue;
        }
        const text = buf.toString("utf8");
        const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        map.set(rel, { insertions: Math.max(lines, 0), deletions: 0 });
      } catch {
        map.set(rel, { insertions: 0, deletions: 0 });
      }
    }
  } catch {
    // ignore
  }
  return map;
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return {
      isGitRepository: false,
      repositoryRoot: null,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      stagedCount: 0,
      unstagedCount: 0,
      conflictCount: 0,
      insertions: 0,
      deletions: 0,
    };
  }

  const [entries, branch, tracking, numstat] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readBranch(repositoryRoot),
    readUpstreamTracking(repositoryRoot),
    readNumstatMap(repositoryRoot),
  ]);

  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    const stats = numstat.get(entry.path) ?? { insertions: 0, deletions: 0 };
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
      staged: isStaged(entry),
      unstaged: isUnstaged(entry),
      insertions: stats.insertions,
      deletions: stats.deletions,
    }];
  });

  return {
    isGitRepository: true,
    repositoryRoot,
    branch,
    upstream: tracking.upstream,
    ahead: tracking.ahead,
    behind: tracking.behind,
    files,
    stagedCount: files.filter((f) => f.staged).length,
    unstagedCount: files.filter((f) => f.unstaged).length,
    conflictCount: files.filter((f) => f.status === "conflict").length,
    insertions: files.reduce((n, f) => n + f.insertions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}

function resolveRepoPaths(repositoryRoot: string, filePaths: string[]): string[] {
  return filePaths.map((filePath) => {
    const resolved = path.resolve(filePath);
    if (!isWithinPath(repositoryRoot, resolved)) {
      throw new Error(`Path outside repository: ${filePath}`);
    }
    return toGitPath(path.relative(repositoryRoot, resolved));
  });
}

export async function stageGitFiles(cwd: string, filePaths: string[]): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  if (filePaths.length === 0) throw new Error("No files to stage");
  const rels = resolveRepoPaths(repositoryRoot, filePaths);
  await git(repositoryRoot, ["add", "--", ...rels]);
  return getGitStatus(cwd);
}

export async function unstageGitFiles(cwd: string, filePaths: string[]): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  if (filePaths.length === 0) throw new Error("No files to unstage");
  const rels = resolveRepoPaths(repositoryRoot, filePaths);
  // restore --staged works even without HEAD in newer git; fallback for empty repos
  try {
    await git(repositoryRoot, ["restore", "--staged", "--", ...rels]);
  } catch {
    await git(repositoryRoot, ["reset", "HEAD", "--", ...rels]);
  }
  return getGitStatus(cwd);
}

export async function commitGitChanges(
  cwd: string,
  message: string,
): Promise<{ commit: string | null; status: GitStatusResponse }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Commit message is required");

  const status = await getGitStatus(cwd);
  if (status.conflictCount > 0) {
    throw new Error("Resolve merge conflicts before committing");
  }
  if (status.stagedCount === 0) throw new Error("No staged changes to commit");

  try {
    await git(repositoryRoot, ["commit", "-m", trimmed]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/identity unknown|user\.name|user\.email/i.test(msg)) {
      throw new Error("Git user.name / user.email is not configured");
    }
    // execFile puts stderr in error - surface a cleaner message
    const stderr = (error as { stderr?: string })?.stderr;
    throw new Error((stderr || msg).trim() || "Commit failed");
  }

  let commit: string | null = null;
  try {
    commit = (await git(repositoryRoot, ["rev-parse", "--short", "HEAD"])).trim() || null;
  } catch {
    commit = null;
  }
  return { commit, status: await getGitStatus(cwd) };
}

export async function discardGitFiles(cwd: string, filePaths: string[]): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  if (filePaths.length === 0) throw new Error("No files to discard");

  const status = await getGitStatus(cwd);
  const byPath = new Map(status.files.map((f) => [path.resolve(f.filePath), f]));

  const tracked: string[] = [];
  const untracked: string[] = [];

  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    if (!isWithinPath(repositoryRoot, resolved)) {
      throw new Error(`Path outside repository: ${filePath}`);
    }
    const entry = byPath.get(resolved);
    const rel = toGitPath(path.relative(repositoryRoot, resolved));
    if (!entry || entry.status === "untracked") {
      untracked.push(rel);
    } else {
      tracked.push(rel);
      // staged changes: drop from index too so discard is complete
      if (entry.staged) {
        try {
          await git(repositoryRoot, ["restore", "--staged", "--", rel]);
        } catch {
          try {
            await git(repositoryRoot, ["reset", "HEAD", "--", rel]);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  if (tracked.length > 0) {
    await git(repositoryRoot, ["restore", "--worktree", "--source=HEAD", "--", ...tracked]);
  }
  if (untracked.length > 0) {
    await git(repositoryRoot, ["clean", "-f", "--", ...untracked]);
  }
  return getGitStatus(cwd);
}

export async function pushGit(cwd: string): Promise<{ message: string; status: GitStatusResponse }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  try {
    const out = await git(repositoryRoot, ["push"], GIT_STATUS_MAX_BUFFER, GIT_NETWORK_TIMEOUT_MS);
    return {
      message: (out || "Push completed").trim() || "Push completed",
      status: await getGitStatus(cwd),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/no upstream|has no upstream|set-upstream/i.test(msg)) {
      const out = await git(repositoryRoot, ["push", "-u", "origin", "HEAD"], GIT_STATUS_MAX_BUFFER, GIT_NETWORK_TIMEOUT_MS);
      return {
        message: (out || "Push completed").trim() || "Push completed",
        status: await getGitStatus(cwd),
      };
    }
    throw error;
  }
}

export async function pullGit(cwd: string): Promise<{ message: string; status: GitStatusResponse }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  try {
    const out = await git(repositoryRoot, ["pull", "--ff-only"], GIT_STATUS_MAX_BUFFER, GIT_NETWORK_TIMEOUT_MS);
    return {
      message: (out || "Already up to date.").trim() || "Pull completed",
      status: await getGitStatus(cwd),
    };
  } catch (error) {
    // fallback to regular pull if no upstream / ff-only fails with diverged history message
    const msg = error instanceof Error ? error.message : String(error);
    if (/Not possible to fast-forward|diverged|no tracking information/i.test(msg)) {
      const out = await git(repositoryRoot, ["pull", "--no-rebase"], GIT_STATUS_MAX_BUFFER, GIT_NETWORK_TIMEOUT_MS);
      return {
        message: (out || "Pull completed").trim() || "Pull completed",
        status: await getGitStatus(cwd),
      };
    }
    throw error;
  }
}

export async function listGitBranches(cwd: string): Promise<{ current: string | null; branches: string[] }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  const out = await git(repositoryRoot, ["branch", "--format=%(refname:short)"]);
  const branches = out.split("\n").map((b) => b.trim()).filter(Boolean);
  const current = await readBranch(repositoryRoot);
  return { current, branches };
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  const name = branch.trim();
  if (!name) throw new Error("Branch name required");
  if (name.includes("..") || /[\s~^:?*\[\\]/.test(name)) {
    throw new Error("Invalid branch name");
  }
  await git(repositoryRoot, ["checkout", name]);
  return getGitStatus(cwd);
}

export async function createGitBranch(cwd: string, branch: string, checkout = true): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  const name = branch.trim();
  if (!name) throw new Error("Branch name required");
  if (name.includes("..") || /[\s~^:?*\[\\]/.test(name)) {
    throw new Error("Invalid branch name");
  }
  if (checkout) {
    await git(repositoryRoot, ["checkout", "-b", name]);
  } else {
    await git(repositoryRoot, ["branch", name]);
  }
  return getGitStatus(cwd);
}

const COMMIT_DIFF_CONTEXT_MAX_CHARS = 14_000;

export type CommitDiffContext = {
  summary: string;
  fileCount: number;
  hasChanges: boolean;
  /** Basename-friendly list used by the heuristic drafter. */
  files: GitFileStatus[];
};

/** Collect a truncated, model-friendly summary of the changes about to be committed. */
export async function getCommitDiffContext(
  cwd: string,
  options?: { includeUnstaged?: boolean; maxChars?: number },
): Promise<CommitDiffContext> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");

  const includeUnstaged = options?.includeUnstaged === true;
  const maxChars = options?.maxChars ?? COMMIT_DIFF_CONTEXT_MAX_CHARS;
  const status = await getGitStatus(cwd);
  const files = status.files.filter((f) => f.staged || (includeUnstaged && f.unstaged));
  if (files.length === 0) {
    return { summary: "", fileCount: 0, hasChanges: false, files: [] };
  }

  const parts: string[] = [];
  parts.push(`Branch: ${status.branch ?? "unknown"}`);
  parts.push("Files:");
  for (const file of files.slice(0, 40)) {
    const rel = toGitPath(path.relative(repositoryRoot, file.filePath));
    const flags = [
      file.staged ? "staged" : null,
      file.unstaged ? "unstaged" : null,
      file.status,
    ].filter(Boolean).join(",");
    parts.push(`- ${rel} (${flags}; +${file.insertions}/-${file.deletions})`);
  }
  if (files.length > 40) {
    parts.push(`- …and ${files.length - 40} more files`);
  }

  const appendSection = async (title: string, args: string[]) => {
    try {
      const text = (await git(repositoryRoot, args)).trim();
      if (!text) return;
      parts.push("", title, text);
    } catch {
      // ignore missing HEAD / empty diffs
    }
  };

  if (files.some((f) => f.staged)) {
    await appendSection("Staged stat:", ["diff", "--cached", "--stat"]);
    await appendSection("Staged name-status:", ["diff", "--cached", "--name-status"]);
    await appendSection("Staged patch:", ["diff", "--cached", "--no-color", "--unified=3"]);
  }

  if (includeUnstaged && files.some((f) => f.unstaged)) {
    await appendSection("Unstaged stat:", ["diff", "--stat"]);
    await appendSection("Unstaged name-status:", ["diff", "--name-status"]);
    await appendSection("Unstaged patch:", ["diff", "--no-color", "--unified=3"]);

    const untracked = files.filter((f) => f.status === "untracked").slice(0, 12);
    if (untracked.length > 0) {
      parts.push("", "Untracked previews:");
      for (const file of untracked) {
        const rel = toGitPath(path.relative(repositoryRoot, file.filePath));
        try {
          const buf = fs.readFileSync(file.filePath);
          if (buf.includes(0) || buf.length > TEXT_PREVIEW_MAX_BYTES) {
            parts.push(`--- ${rel} (binary or large, skipped)`);
            continue;
          }
          const text = buf.toString("utf8");
          const preview = text.split("\n").slice(0, 40).join("\n");
          parts.push(`--- ${rel}`, preview);
        } catch {
          parts.push(`--- ${rel} (unreadable)`);
        }
      }
    }
  }

  let summary = parts.join("\n").trim();
  if (summary.length > maxChars) {
    summary = `${summary.slice(0, maxChars)}\n\n…(truncated)`;
  }

  return {
    summary,
    fileCount: files.length,
    hasChanges: true,
    files,
  };
}

/** Build a concise commit message from staged changes (no LLM). */
export async function draftCommitMessage(
  cwd: string,
  options?: { includeUnstaged?: boolean },
): Promise<string> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  const context = await getCommitDiffContext(cwd, {
    includeUnstaged: options?.includeUnstaged,
  });
  if (!context.hasChanges) {
    throw new Error(options?.includeUnstaged ? "No changes to commit" : "No staged changes");
  }

  const target = options?.includeUnstaged
    ? context.files
    : context.files.filter((f) => f.staged);
  if (target.length === 0) throw new Error("No staged changes");

  let stat = "";
  try {
    if (target.some((f) => f.staged) && !options?.includeUnstaged) {
      stat = (await git(repositoryRoot, ["diff", "--cached", "--stat"])).trim();
    } else {
      // Combined view when drafting over staged+unstaged without staging yet.
      const cached = target.some((f) => f.staged)
        ? (await git(repositoryRoot, ["diff", "--cached", "--stat"]).catch(() => "")).trim()
        : "";
      const worktree = target.some((f) => f.unstaged)
        ? (await git(repositoryRoot, ["diff", "--stat"]).catch(() => "")).trim()
        : "";
      stat = [cached, worktree].filter(Boolean).join("\n");
    }
  } catch {
    stat = "";
  }

  const names = target.map((f) => path.basename(f.filePath));
  const kinds = new Set(target.map((f) => f.status));
  let verb = "Update";
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only === "added" || only === "untracked") verb = "Add";
    else if (only === "deleted") verb = "Remove";
    else if (only === "renamed") verb = "Rename";
    else verb = "Update";
  } else if (kinds.has("added") && !kinds.has("modified") && !kinds.has("deleted")) {
    verb = "Add";
  }

  const subject = names.length <= 3
    ? `${verb} ${names.join(", ")}`
    : `${verb} ${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

  const lines = [subject.slice(0, 72)];
  if (stat) {
    lines.push("", stat.split("\n").slice(0, 12).join("\n"));
  }
  return lines.join("\n").trim();
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const entries = await readStatusEntries(repositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") return { supported: false };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}
