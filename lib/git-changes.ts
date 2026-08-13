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
import { getGithubAccount } from "./accounts-store";
import { githubAuthEnv, redactGitAuth, type GitAuthEnv } from "./git-github-auth";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

const BRANCH_HEADER_PREFIX = "## ";
const DETACHED_HEADER = "HEAD (no branch)";
const NEWLINE_BYTE = 0x0a;
const UNTRACKED_LINE_COUNT_CONCURRENCY = 8;

/** Branch/upstream state parsed from the porcelain `--branch` header. */
type GitHeadInfo = {
  /** null for a detached HEAD — resolveBranchLabel() falls back to the sha. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
};

/** One `git status --porcelain --branch` read, shared by status and diff calls. */
type GitStatusSnapshot = {
  entries: GitPorcelainEntry[];
  head: GitHeadInfo;
};

export async function runGit(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
  timeout = GIT_TIMEOUT_MS,
  extraEnv?: GitAuthEnv,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), ["-C", cwd, ...args], {
      timeout,
      maxBuffer,
      env: extraEnv ? { ...gitProcessEnv(), ...extraEnv } : gitProcessEnv(),
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "";
    const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "";
    throw new Error(redactGitAuth((stderr || stdout || err.message || "git failed").trim()));
  }
}

/** Network-capable git runs (push/pull) need more headroom than local reads. */
export const GIT_NETWORK_TIMEOUT_MS = 120_000;

// Kept as a thin alias so existing internal call sites stay untouched.
async function git(
  cwd: string,
  args: string[],
  maxBuffer = GIT_STATUS_MAX_BUFFER,
  timeout = GIT_TIMEOUT_MS,
): Promise<string> {
  return runGit(cwd, args, maxBuffer, timeout);
}

// ============================================================================
// Read caches
//
// One getGitStatus() round spawns several git processes, the Git panel and the
// file explorer poll the same cwd, and every expanded file diff needs the same
// porcelain snapshot. Cached reads therefore get a very short TTL plus
// in-flight coalescing — same shape as loadModelsWithCache() in
// lib/models-cache.ts, kept on globalThis so dev hot-reload does not reset it
// (like globalThis.__piSessions in lib/rpc-manager.ts).
//
// Three layers keep the UI from showing a stale tree, strongest first:
//   1. every mutating helper below calls invalidateGitStatusCache() right after
//      the write and before it re-reads the status,
//   2. cached values are revalidated against a fingerprint of the repository
//      index/HEAD, so writes this module does not perform (git-conflict.ts,
//      git-merge.ts, a `git add` typed into the built-in terminal) are picked
//      up immediately,
//   3. GET ?fresh=1 (explorer / review after write/edit) skips the stored
//      value; the 1s TTL only covers accidental repeat reads.
// ============================================================================

const GIT_CACHE_TTL_MS = 1_000;
/** cwd → repository root is structural: it only changes on init/clone/move. */
const GIT_ROOT_CACHE_TTL_MS = 30_000;
const MAX_GIT_CACHE_ENTRIES = 32;

/** How a cached value is revalidated when it is read back. */
type GitCacheGuard =
  | { kind: "fingerprint"; repositoryRoot: string; fingerprint: string }
  | { kind: "ttl" }
  | { kind: "never" };

type GitCacheEntry<T> = { value: T; expiresAt: number; guard: GitCacheGuard };

type GitCacheBucket<T> = {
  entries: Map<string, GitCacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
};

type GitCacheLoad<T> = { value: T; guard: GitCacheGuard };

type GitCacheState = {
  /** cwd → full status response */
  status: GitCacheBucket<GitStatusResponse>;
  /** repository root → porcelain snapshot shared by status and diff reads */
  snapshots: GitCacheBucket<GitStatusSnapshot>;
  /** cwd → repository root */
  roots: GitCacheBucket<string | null>;
  /** repository root → git dir (`.git` is a file inside linked worktrees) */
  gitDirs: Map<string, string | null>;
};

declare global {
  var __piGitCacheState: GitCacheState | undefined;
}

function createGitCacheBucket<T>(): GitCacheBucket<T> {
  return { entries: new Map(), inFlight: new Map() };
}

function getGitCacheState(): GitCacheState {
  if (!globalThis.__piGitCacheState) {
    globalThis.__piGitCacheState = {
      status: createGitCacheBucket<GitStatusResponse>(),
      snapshots: createGitCacheBucket<GitStatusSnapshot>(),
      roots: createGitCacheBucket<string | null>(),
      gitDirs: new Map(),
    };
  }
  return globalThis.__piGitCacheState;
}

/**
 * Drop every cached status/porcelain snapshot. Called after each mutating git
 * operation — clearing globally instead of per cwd is deliberate: one
 * repository is reachable through many cwds (subdirectories, worktrees) and a
 * write through any of them makes all of their snapshots stale. Repository-root
 * lookups are structural and survive.
 */
export function invalidateGitStatusCache(): void {
  const state = globalThis.__piGitCacheState;
  if (!state) return;
  state.status.entries.clear();
  state.status.inFlight.clear();
  state.snapshots.entries.clear();
  state.snapshots.inFlight.clear();
}

function resolveGitDir(repositoryRoot: string): string | null {
  const state = getGitCacheState();
  const cached = state.gitDirs.get(repositoryRoot);
  if (cached !== undefined) return cached;
  let gitDir: string | null = null;
  try {
    const dotGit = path.join(repositoryRoot, ".git");
    if (fs.statSync(dotGit).isDirectory()) {
      gitDir = dotGit;
    } else {
      // Linked worktree: `.git` is a file containing "gitdir: <path>".
      const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
      const target = match?.[1]?.trim();
      gitDir = target ? path.resolve(repositoryRoot, target) : null;
    }
  } catch {
    gitDir = null;
  }
  state.gitDirs.set(repositoryRoot, gitDir);
  return gitDir;
}

/**
 * Cheap change token for a repository: index + HEAD mtime/size. Every git write
 * rewrites at least one of them, so a changed token means cached snapshots must
 * not be reused. Returns "" when the layout cannot be read, which callers treat
 * as "not cacheable".
 */
function repositoryFingerprint(repositoryRoot: string): string {
  const gitDir = resolveGitDir(repositoryRoot);
  if (!gitDir) return "";
  const stamp = (name: string): string => {
    try {
      const stat = fs.statSync(path.join(gitDir, name));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "-";
    }
  };
  return `${stamp("index")}|${stamp("HEAD")}`;
}

/**
 * Guard for a value read between two fingerprints: if the repository changed
 * while we were reading it, the value may already describe the past and is not
 * cached at all.
 */
function fingerprintGuard(repositoryRoot: string, before: string): GitCacheGuard {
  if (!before || before !== repositoryFingerprint(repositoryRoot)) return { kind: "never" };
  return { kind: "fingerprint", repositoryRoot, fingerprint: before };
}

function guardHolds(guard: GitCacheGuard): boolean {
  if (guard.kind === "ttl") return true;
  if (guard.kind === "never") return false;
  return repositoryFingerprint(guard.repositoryRoot) === guard.fingerprint;
}

function pruneGitCacheBucket<T>(bucket: GitCacheBucket<T>): void {
  const now = Date.now();
  for (const [key, entry] of bucket.entries) {
    if (entry.expiresAt <= now) bucket.entries.delete(key);
  }
  while (bucket.entries.size >= MAX_GIT_CACHE_ENTRIES) {
    const oldestKey = bucket.entries.keys().next().value;
    if (oldestKey === undefined) break;
    bucket.entries.delete(oldestKey);
  }
}

function withGitCache<T>(
  bucket: GitCacheBucket<T>,
  key: string,
  load: () => Promise<GitCacheLoad<T>>,
  options?: { ttlMs?: number; allowCached?: boolean },
): Promise<T> {
  const cached = bucket.entries.get(key);
  if (cached) {
    if (options?.allowCached !== false && cached.expiresAt > Date.now() && guardHolds(cached.guard)) {
      return Promise.resolve(cached.value);
    }
    bucket.entries.delete(key);
  }

  // Coalesce even when a fresh value was requested: a load that is already
  // running is at most one request old, and this is what collapses a fan-out of
  // parallel diff requests into a single git call.
  const existing = bucket.inFlight.get(key);
  if (existing) return existing;

  const ttlMs = options?.ttlMs ?? GIT_CACHE_TTL_MS;
  const loadPromise: Promise<T> = Promise.resolve()
    .then(load)
    .then(({ value, guard }) => {
      // invalidateGitStatusCache() drops in-flight entries; the identity check
      // keeps a load started before a write from repopulating the cache.
      if (guard.kind !== "never" && bucket.inFlight.get(key) === loadPromise) {
        pruneGitCacheBucket(bucket);
        bucket.entries.set(key, { value, expiresAt: Date.now() + ttlMs, guard });
      }
      return value;
    })
    .finally(() => {
      if (bucket.inFlight.get(key) === loadPromise) bucket.inFlight.delete(key);
    });

  bucket.inFlight.set(key, loadPromise);
  return loadPromise;
}

function findRepositoryRoot(cwd: string): Promise<string | null> {
  return withGitCache(getGitCacheState().roots, cwd, async () => {
    let root: string | null = null;
    try {
      root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
    } catch {
      root = null;
    }
    // Positives only: a plain directory can become a repository at any time
    // (git init / clone) and a miss costs a single spawn.
    return { value: root, guard: root ? { kind: "ttl" } : { kind: "never" } };
  }, { ttlMs: GIT_ROOT_CACHE_TTL_MS });
}

function forgetRepositoryRoot(cwd: string): void {
  const state = globalThis.__piGitCacheState;
  if (!state) return;
  state.roots.entries.delete(cwd);
  state.gitDirs.clear();
}

function realPath(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** isWithinPath() with the parent already resolved — hoist it out of loops. */
function isWithinRealPath(realParent: string, target: string): boolean {
  const relative = path.relative(realParent, realPath(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isWithinPath(parent: string, target: string): boolean {
  // realpath so macOS /var → /private/var (and similar) still counts as inside.
  return isWithinRealPath(realPath(parent), target);
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusSnapshot(
  repositoryRoot: string,
  options?: { allowCached?: boolean },
): Promise<GitStatusSnapshot> {
  return withGitCache(getGitCacheState().snapshots, repositoryRoot, async () => {
    const before = repositoryFingerprint(repositoryRoot);
    const value = await loadStatusSnapshot(repositoryRoot);
    return { value, guard: fingerprintGuard(repositoryRoot, before) };
  }, { allowCached: options?.allowCached });
}

/**
 * `--branch` prepends one NUL-terminated header record to the porcelain output,
 * which hands us branch + upstream + ahead/behind without the three extra
 * spawns (`branch --show-current`, `rev-parse @{upstream}`, `rev-list`).
 */
async function loadStatusSnapshot(repositoryRoot: string): Promise<GitStatusSnapshot> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  if (!output.startsWith(BRANCH_HEADER_PREFIX)) {
    return { entries: parseGitPorcelainV1(output), head: emptyHeadInfo() };
  }
  const headerEnd = output.indexOf("\0");
  const header = headerEnd === -1 ? output : output.slice(0, headerEnd);
  const body = headerEnd === -1 ? "" : output.slice(headerEnd + 1);
  return { entries: parseGitPorcelainV1(body), head: parseBranchHeader(header) };
}

function emptyHeadInfo(): GitHeadInfo {
  return { branch: null, upstream: null, ahead: 0, behind: 0 };
}

/**
 * Parse the porcelain v1 branch header, one of:
 *   "## main...origin/main [ahead 1, behind 2]" · "## main" ·
 *   "## HEAD (no branch)" · "## No commits yet on main"
 */
function parseBranchHeader(header: string): GitHeadInfo {
  const head = emptyHeadInfo();
  let text = header.slice(BRANCH_HEADER_PREFIX.length).trim();
  if (!text || text === DETACHED_HEADER) return head;

  let gone = false;
  const divergence = /\s\[([^\]]*)\]$/.exec(text);
  if (divergence) {
    text = text.slice(0, divergence.index);
    const state = divergence[1] ?? "";
    // "[gone]" = the tracked branch was deleted upstream; report no upstream,
    // which is what resolving @{upstream} used to yield.
    gone = state.trim() === "gone";
    const ahead = /ahead (\d+)/.exec(state);
    const behind = /behind (\d+)/.exec(state);
    head.ahead = ahead ? Number.parseInt(ahead[1] ?? "0", 10) || 0 : 0;
    head.behind = behind ? Number.parseInt(behind[1] ?? "0", 10) || 0 : 0;
  }

  // Refs cannot contain "..", so the first "..." separates local from upstream.
  const separator = text.indexOf("...");
  let local = separator === -1 ? text : text.slice(0, separator);
  if (separator !== -1 && !gone) head.upstream = text.slice(separator + 3).trim() || null;
  local = local.replace(/^No commits yet on /, "").trim();
  head.branch = local || null;
  return head;
}

/** Detached HEAD (and unexpected header shapes) still need the old lookup. */
async function resolveBranchLabel(repositoryRoot: string, head: GitHeadInfo): Promise<string | null> {
  return head.branch ?? await readBranch(repositoryRoot);
}

function isStaged(entry: GitPorcelainEntry): boolean {
  return entry.indexStatus !== " " && entry.indexStatus !== "?";
}

function isUnstaged(entry: GitPorcelainEntry): boolean {
  // worktreeStatus is " " when clean; "?" for untracked (??) and letter codes for edits.
  // (Do not add `=== "?"` after a `!== " "` check — TS narrows worktree to " " on the RHS.)
  return entry.worktreeStatus !== " ";
}

function isUntracked(entry: GitPorcelainEntry): boolean {
  return entry.indexStatus === "?" && entry.worktreeStatus === "?";
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

/**
 * Line count for an untracked file without buffering it: stat first (the old
 * version read a 500MB file into memory before noticing it was oversized), then
 * stream and bail out as soon as it turns out to be binary. Returns 0 for
 * binary / oversized / unreadable files, matching the previous behaviour.
 */
async function countTextLines(absolutePath: string): Promise<number> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch {
    return 0;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > TEXT_PREVIEW_MAX_BYTES) return 0;

  return new Promise<number>((resolve) => {
    const stream = fs.createReadStream(absolutePath);
    let lines = 0;
    let lastByte = 0;
    let binary = false;
    stream.on("data", (chunk: string | Buffer) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (buf.includes(0)) {
        binary = true;
        stream.destroy();
        return;
      }
      for (let at = buf.indexOf(NEWLINE_BYTE); at !== -1; at = buf.indexOf(NEWLINE_BYTE, at + 1)) {
        lines += 1;
      }
      lastByte = buf[buf.length - 1] ?? lastByte;
    });
    stream.on("error", () => resolve(0));
    // Counts newline-terminated lines plus a trailing unterminated one.
    stream.on("close", () => resolve(binary ? 0 : lines + (lastByte === NEWLINE_BYTE ? 0 : 1)));
  });
}

async function forEachLimited<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
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
    // Worktree vs HEAD already covers staged changes, so `--cached` is only a
    // fallback for repositories without a HEAD; merging both double-counted
    // every staged file.
    merge(await git(repositoryRoot, ["diff", "--numstat", "HEAD"]));
  } catch {
    try {
      merge(await git(repositoryRoot, ["diff", "--cached", "--numstat"]));
    } catch {
      // no HEAD and nothing staged
    }
  }
  return map;
}

/**
 * Untracked files carry no diff, so their insertions come from counting lines.
 * The paths come from the porcelain snapshot we already have — `ls-files
 * --others --exclude-standard` returns exactly the same set for one more spawn.
 */
async function addUntrackedLineCounts(
  repositoryRoot: string,
  entries: GitPorcelainEntry[],
  map: Map<string, { insertions: number; deletions: number }>,
): Promise<void> {
  const untracked = entries
    .filter((entry) => isUntracked(entry) && !map.has(entry.path))
    .map((entry) => entry.path);
  await forEachLimited(untracked, UNTRACKED_LINE_COUNT_CONCURRENCY, async (rel) => {
    const insertions = await countTextLines(path.resolve(repositoryRoot, rel));
    map.set(rel, { insertions, deletions: 0 });
  });
}

function notARepositoryStatus(): GitStatusResponse {
  return {
    isGitRepository: false,
    repositoryRoot: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRemote: false,
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
    conflictCount: 0,
    insertions: 0,
    deletions: 0,
  };
}

function toStatusFiles(
  cwd: string,
  repositoryRoot: string,
  entries: GitPorcelainEntry[],
  numstat: Map<string, { insertions: number; deletions: number }>,
): GitFileStatus[] {
  // Resolve the boundary once instead of once per entry: 500 changed files used
  // to mean 1000 realpathSync calls.
  const realCwd = realPath(cwd);
  return entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinRealPath(realCwd, filePath)) return [];
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
}

export async function getGitStatus(
  cwd: string,
  options?: { allowCached?: boolean },
): Promise<GitStatusResponse> {
  return withGitCache(getGitCacheState().status, cwd, async () => {
    const repositoryRoot = await findRepositoryRoot(cwd);
    if (!repositoryRoot) {
      return { value: notARepositoryStatus(), guard: { kind: "ttl" } };
    }

    try {
      const before = repositoryFingerprint(repositoryRoot);
      // Always re-read the porcelain snapshot here (this response has its own
      // TTL; layering two caches would stack their staleness) while still
      // publishing it for the diff requests that share the bucket.
      const [snapshot, numstat, remoteOut] = await Promise.all([
        readStatusSnapshot(repositoryRoot, { allowCached: false }),
        readNumstatMap(repositoryRoot),
        git(repositoryRoot, ["remote"]).catch(() => ""),
      ]);
      await addUntrackedLineCounts(repositoryRoot, snapshot.entries, numstat);
      const branch = await resolveBranchLabel(repositoryRoot, snapshot.head);
      const files = toStatusFiles(cwd, repositoryRoot, snapshot.entries, numstat);

      return {
        value: {
          isGitRepository: true,
          repositoryRoot,
          branch,
          upstream: snapshot.head.upstream,
          ahead: snapshot.head.ahead,
          behind: snapshot.head.behind,
          hasRemote: remoteOut.split("\n").some((line) => line.trim()),
          files,
          stagedCount: files.filter((f) => f.staged).length,
          unstagedCount: files.filter((f) => f.unstaged).length,
          conflictCount: files.filter((f) => f.status === "conflict").length,
          insertions: files.reduce((n, f) => n + f.insertions, 0),
          deletions: files.reduce((n, f) => n + f.deletions, 0),
        },
        guard: fingerprintGuard(repositoryRoot, before),
      };
    } catch (error) {
      // The remembered root stopped resolving (repository deleted or moved):
      // forget it so the next poll re-detects instead of failing until the
      // root entry expires.
      forgetRepositoryRoot(cwd);
      throw error;
    }
  }, { allowCached: options?.allowCached });
}

function resolveRepoPaths(repositoryRoot: string, filePaths: string[]): string[] {
  const realRoot = realPath(repositoryRoot);
  return filePaths.map((filePath) => {
    const resolved = path.resolve(filePath);
    if (!isWithinRealPath(realRoot, resolved)) {
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
  try {
    await git(repositoryRoot, ["add", "--", ...rels]);
  } finally {
    // Also on failure: `git add` can apply partially, and hooks may edit files.
    invalidateGitStatusCache();
  }
  return getGitStatus(cwd);
}

export async function unstageGitFiles(cwd: string, filePaths: string[]): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  if (filePaths.length === 0) throw new Error("No files to unstage");
  const rels = resolveRepoPaths(repositoryRoot, filePaths);
  // restore --staged works even without HEAD in newer git; fallback for empty repos
  try {
    try {
      await git(repositoryRoot, ["restore", "--staged", "--", ...rels]);
    } catch {
      await git(repositoryRoot, ["reset", "HEAD", "--", ...rels]);
    }
  } finally {
    invalidateGitStatusCache();
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
  } finally {
    // A failed commit can still have moved the tree (pre-commit hooks).
    invalidateGitStatusCache();
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
  const realRoot = realPath(repositoryRoot);

  const tracked: string[] = [];
  const untracked: string[] = [];

  try {
    for (const filePath of filePaths) {
      const resolved = path.resolve(filePath);
      if (!isWithinRealPath(realRoot, resolved)) {
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
  } finally {
    // Discard is partially applied when one of the paths is rejected.
    invalidateGitStatusCache();
  }
  return getGitStatus(cwd);
}

async function githubRemoteAuth(repositoryRoot: string, remoteName: string): Promise<GitAuthEnv | undefined> {
  const url = (await git(repositoryRoot, ["remote", "get-url", remoteName]).catch(() => "")).trim();
  return githubAuthEnv(getGithubAccount()?.token, url);
}

export async function pushGit(cwd: string): Promise<{
  message: string;
  status: GitStatusResponse;
  /** True when the repo has no remotes at all — the UI then offers the
   *  VSCode-style publish flow (create remote → private/public → push). */
  needRemote?: boolean;
}> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  // Push only moves refs, which the index/HEAD fingerprint cannot see — the
  // ahead/behind counters would keep the pre-push numbers without this.
  const run = async (args: string[], extraEnv?: GitAuthEnv): Promise<string> => {
    try {
      return await runGit(repositoryRoot, args, GIT_STATUS_MAX_BUFFER, GIT_NETWORK_TIMEOUT_MS, extraEnv);
    } finally {
      invalidateGitStatusCache();
    }
  };
  try {
    const remotes = (await runGit(repositoryRoot, ["remote"]))
      .split("\n").map((r) => r.trim()).filter(Boolean);
    if (remotes.length === 0) {
      // No remote library at all — nothing to push to. The caller decides
      // whether the user is signed in and shows the publish dialog.
      return { message: "", status: await getGitStatus(cwd), needRemote: true };
    }
    const remoteName = remotes.includes("origin") ? "origin" : remotes[0]!;
    const auth = await githubRemoteAuth(repositoryRoot, remoteName);
    const out = await run(["push"], auth);
    return {
      message: (out || "Push completed").trim() || "Push completed",
      status: await getGitStatus(cwd),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/no upstream|has no upstream|set-upstream/i.test(msg)) {
      const auth = await githubRemoteAuth(repositoryRoot, "origin");
      const out = await run(["push", "-u", "origin", "HEAD"], auth);
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
  const run = async (args: string[], extraEnv?: GitAuthEnv): Promise<string> => {
    try {
      return await runGit(repositoryRoot, args, GIT_STATUS_MAX_BUFFER, GIT_NETWORK_TIMEOUT_MS, extraEnv);
    } finally {
      invalidateGitStatusCache();
    }
  };
  try {
    const auth = await githubRemoteAuth(repositoryRoot, "origin");
    const out = await run(["pull", "--ff-only"], auth);
    return {
      message: (out || "Already up to date.").trim() || "Pull completed",
      status: await getGitStatus(cwd),
    };
  } catch (error) {
    // fallback to regular pull if no upstream / ff-only fails with diverged history message
    const msg = error instanceof Error ? error.message : String(error);
    if (/Not possible to fast-forward|diverged|no tracking information/i.test(msg)) {
      const auth = await githubRemoteAuth(repositoryRoot, "origin");
      const out = await run(["pull", "--no-rebase"], auth);
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
  try {
    await git(repositoryRoot, ["checkout", name]);
  } finally {
    invalidateGitStatusCache();
  }
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
  try {
    if (checkout) {
      await git(repositoryRoot, ["checkout", "-b", name]);
    } else {
      await git(repositoryRoot, ["branch", name]);
    }
  } finally {
    invalidateGitStatusCache();
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
  options?: { includeUnstaged?: boolean; maxChars?: number; repositoryRoot?: string },
): Promise<CommitDiffContext> {
  const repositoryRoot = options?.repositoryRoot ?? await findRepositoryRoot(cwd);
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

  const sections: Array<{ title: string; args: string[] }> = [];
  if (files.some((f) => f.staged)) {
    sections.push(
      { title: "Staged stat:", args: ["diff", "--cached", "--stat"] },
      { title: "Staged name-status:", args: ["diff", "--cached", "--name-status"] },
      { title: "Staged patch:", args: ["diff", "--cached", "--no-color", "--unified=3"] },
    );
  }
  const withUnstaged = includeUnstaged && files.some((f) => f.unstaged);
  if (withUnstaged) {
    sections.push(
      { title: "Unstaged stat:", args: ["diff", "--stat"] },
      { title: "Unstaged name-status:", args: ["diff", "--name-status"] },
      { title: "Unstaged patch:", args: ["diff", "--no-color", "--unified=3"] },
    );
  }

  // Independent diffs — run them together instead of six serial spawns.
  const rendered = await Promise.all(sections.map(async (section) => {
    try {
      return { title: section.title, text: (await git(repositoryRoot, section.args)).trim() };
    } catch {
      // ignore missing HEAD / empty diffs
      return { title: section.title, text: "" };
    }
  }));
  for (const section of rendered) {
    if (section.text) parts.push("", section.title, section.text);
  }

  if (withUnstaged) {
    const untracked = files.filter((f) => f.status === "untracked").slice(0, 12);
    if (untracked.length > 0) {
      parts.push("", "Untracked previews:");
      parts.push(...await Promise.all(untracked.map(async (file) => {
        const rel = toGitPath(path.relative(repositoryRoot, file.filePath));
        try {
          // Size first, then read: the old version buffered the file to find out.
          const stat = await fs.promises.stat(file.filePath);
          if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) {
            return `--- ${rel} (binary or large, skipped)`;
          }
          const buf = await fs.promises.readFile(file.filePath);
          if (hasNullByte(buf)) return `--- ${rel} (binary or large, skipped)`;
          const preview = buf.toString("utf8").split("\n").slice(0, 40).join("\n");
          return `--- ${rel}\n${preview}`;
        } catch {
          return `--- ${rel} (unreadable)`;
        }
      })));
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
  options?: { includeUnstaged?: boolean; repositoryRoot?: string },
): Promise<string> {
  const repositoryRoot = options?.repositoryRoot ?? await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a git repository");
  const context = await getCommitDiffContext(cwd, {
    includeUnstaged: options?.includeUnstaged,
    repositoryRoot,
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
      const [cached, worktree] = await Promise.all([
        target.some((f) => f.staged)
          ? git(repositoryRoot, ["diff", "--cached", "--stat"]).catch(() => "")
          : Promise.resolve(""),
        target.some((f) => f.unstaged)
          ? git(repositoryRoot, ["diff", "--stat"]).catch(() => "")
          : Promise.resolve(""),
      ]);
      stat = [cached.trim(), worktree.trim()].filter(Boolean).join("\n");
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

export async function getGitFileDiff(
  cwd: string,
  filePath: string,
  options?: { allowCached?: boolean },
): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  // Shared snapshot: expanding N files in the Git panel fires N diff requests
  // that used to run a full-repository status each.
  const { entries } = await readStatusSnapshot(repositoryRoot, {
    allowCached: options?.allowCached,
  });
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") return { supported: false };

  const currentBuffer = await fs.promises.readFile(resolvedFilePath);
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
