import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { getGitStatus } from "./git-changes";
import type { GitStatusResponse } from "./git-types";
import { gitProcessEnv, resolveGitBinary } from "./resolve-git";
import { assistantText } from "./message-text";
import { completeWithUtilityModel } from "./utility-model";
import { readWebSettings } from "./web-settings";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const MAX_AI_FILE_CHARS = 40_000;

export type ConflictSide = "ours" | "theirs" | "base";

export type ConflictStage = {
  stage: 1 | 2 | 3;
  mode: string;
  oid: string;
  path: string;
};

export type ConflictFileDetail = {
  filePath: string;
  relativePath: string;
  stages: ConflictStage[];
  hasMarkers: boolean;
  content: string | null;
  binary: boolean;
};

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: gitProcessEnv(),
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string | Buffer; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "";
    throw new Error((stderr || err.message || "git failed").trim());
  }
}

async function findRepositoryRoot(cwd: string): Promise<string> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    if (!root) throw new Error("Not a git repository");
    return root;
  } catch {
    throw new Error("Not a git repository");
  }
}

function real(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(real(parent), real(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function resolveRel(repositoryRoot: string, filePath: string): string {
  const root = real(repositoryRoot);
  const resolved = real(filePath);
  if (!isWithinPath(root, resolved)) {
    throw new Error(`Path outside repository: ${filePath}`);
  }
  return toGitPath(path.relative(root, resolved));
}

/** Parse `git ls-files -u` lines: <mode> <oid> <stage>\t<path> */
function parseUnmerged(output: string): ConflictStage[] {
  const stages: ConflictStage[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // format: mode SP oid SP stage TAB path
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const meta = line.slice(0, tab).trim().split(/\s+/);
    const filePath = line.slice(tab + 1);
    if (meta.length < 3) continue;
    const stageNum = Number(meta[2]);
    if (stageNum !== 1 && stageNum !== 2 && stageNum !== 3) continue;
    stages.push({
      stage: stageNum,
      mode: meta[0]!,
      oid: meta[1]!,
      path: filePath,
    });
  }
  return stages;
}

export async function getConflictFileDetail(cwd: string, filePath: string): Promise<ConflictFileDetail> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  const rel = resolveRel(repositoryRoot, filePath);
  const abs = path.resolve(repositoryRoot, rel);
  const unmerged = await git(repositoryRoot, ["ls-files", "-u", "--", rel]);
  const stages = parseUnmerged(unmerged);
  if (stages.length === 0) {
    throw new Error("File is not in a merge conflict");
  }

  let content: string | null = null;
  let binary = false;
  let hasMarkers = false;
  try {
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) {
      binary = true;
    } else {
      content = buf.toString("utf8");
      hasMarkers = content.includes("<<<<<<<") && content.includes(">>>>>>>");
    }
  } catch {
    content = null;
  }

  return {
    filePath: abs,
    relativePath: rel,
    stages,
    hasMarkers,
    content,
    binary,
  };
}

async function writeAndStage(repositoryRoot: string, rel: string, content: string): Promise<void> {
  const abs = path.resolve(repositoryRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  await git(repositoryRoot, ["add", "--", rel]);
}

async function removeAndStage(repositoryRoot: string, rel: string): Promise<void> {
  const abs = path.resolve(repositoryRoot, rel);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    // ignore
  }
  try {
    await git(repositoryRoot, ["rm", "-f", "--", rel]);
  } catch {
    await git(repositoryRoot, ["add", "--", rel]);
  }
}

export async function resolveConflictSide(
  cwd: string,
  filePath: string,
  side: ConflictSide,
): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  const rel = resolveRel(repositoryRoot, filePath);
  const detail = await getConflictFileDetail(cwd, filePath);
  const stageMap = new Map(detail.stages.map((s) => [s.stage, s]));

  if (side === "ours") {
    // Prefer checkout --ours; if stage 2 missing (deleted by us), remove.
    if (!stageMap.has(2)) {
      await removeAndStage(repositoryRoot, rel);
    } else {
      await git(repositoryRoot, ["checkout", "--ours", "--", rel]);
      await git(repositoryRoot, ["add", "--", rel]);
    }
  } else if (side === "theirs") {
    if (!stageMap.has(3)) {
      await removeAndStage(repositoryRoot, rel);
    } else {
      await git(repositoryRoot, ["checkout", "--theirs", "--", rel]);
      await git(repositoryRoot, ["add", "--", rel]);
    }
  } else {
    // base = stage 1
    const base = stageMap.get(1);
    if (!base) {
      throw new Error("No common base version for this conflict");
    }
    const blob = await git(repositoryRoot, ["cat-file", "-p", base.oid]);
    await writeAndStage(repositoryRoot, rel, blob);
  }

  return getGitStatus(cwd);
}

export async function resolveConflictContent(
  cwd: string,
  filePath: string,
  content: string,
): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  const rel = resolveRel(repositoryRoot, filePath);
  // Ensure it was conflicted
  await getConflictFileDetail(cwd, filePath);
  await writeAndStage(repositoryRoot, rel, content);
  return getGitStatus(cwd);
}

function stripFence(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return text;
}

export async function draftConflictResolutionWithAi(
  cwd: string,
  filePath: string,
): Promise<{ content: string; explanation: string; status: GitStatusResponse }> {
  const detail = await getConflictFileDetail(cwd, filePath);
  if (detail.binary || detail.content == null) {
    throw new Error("Cannot AI-resolve binary or missing conflict file");
  }
  if (!detail.hasMarkers) {
    throw new Error("File has no conflict markers; use Stage after manual edit");
  }

  let fileBody = detail.content;
  if (fileBody.length > MAX_AI_FILE_CHARS) {
    fileBody = `${fileBody.slice(0, MAX_AI_FILE_CHARS)}\n\n…(truncated for AI resolve)`;
  }

  const prefs = readWebSettings();
  const preferred = prefs.modelRoles.plan ?? prefs.modelRoles.default ?? prefs.commitModel;
  const { response, resolved } = await completeWithUtilityModel(cwd, preferred, {
    systemPrompt: [
      "You resolve git merge conflicts.",
      "Rules:",
      "- Output ONLY the full resolved file content.",
      "- No markdown fences, no commentary, no conflict markers (<<<<<<< ======= >>>>>>>).",
      "- Keep valid syntax for the file type.",
      "- Prefer combining both sides when both changes are valid; otherwise choose the safer correct version.",
    ].join("\n"),
    messages: [{
      role: "user",
      content: [
        `Resolve merge conflicts in ${detail.relativePath}.`,
        "",
        "Conflicted file:",
        "```",
        fileBody,
        "```",
      ].join("\n"),
      timestamp: Date.now(),
    }],
  }, {
    maxTokens: 8000,
    temperature: 0.1,
    timeoutMs: 60_000,
    maxRetries: 0,
    cacheRetention: "none",
  });

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage ?? "AI conflict resolve failed");
  }

  const content = stripFence(assistantText(response));
  if (!content) throw new Error("AI returned empty resolution");
  if (content.includes("<<<<<<<") || content.includes(">>>>>>>")) {
    throw new Error("AI resolution still contains conflict markers");
  }

  const status = await resolveConflictContent(cwd, filePath, content);
  return {
    content,
    explanation: `Resolved ${detail.relativePath} with ${formatModel(resolved.ref)}`,
    status,
  };
}

function formatModel(ref: { provider: string; modelId: string }): string {
  return `${ref.provider}/${ref.modelId}`;
}
