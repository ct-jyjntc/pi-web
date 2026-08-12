/**
 * Owns git commit-history reads for the Git panel's History section
 * (log list, commit detail + per-file stats, per-file patch). Light-runtime
 * safe — system git only, no SDK.
 */
import { runGit } from "./git-changes";

const GIT_HISTORY_MAX_BUFFER = 8 * 1024 * 1024;
const GIT_LOG_RECORD_SEP = "\x1e";
const GIT_LOG_FIELD_SEP = "\x1f";

export type GitCommitSummary = {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  fileCount: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFile = {
  path: string;
  originalPath: string | null;
  status: string;
  insertions: number;
  deletions: number;
};

export type GitCommitDetail = {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  files: GitCommitFile[];
};

async function repositoryRootOf(cwd: string): Promise<string> {
  const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) throw new Error("Not a git repository");
  return root;
}

/**
 * `git log --shortstat` interleaves one shortstat block after every commit
 * record, so a single spawn yields subjects + per-commit ± stats.
 */
export async function getGitLog(cwd: string, limit = 50): Promise<GitCommitSummary[]> {
  const repositoryRoot = await repositoryRootOf(cwd);
  const output = await runGit(
    repositoryRoot,
    [
      "log", `-n ${limit}`,
      `--pretty=format:%H${GIT_LOG_FIELD_SEP}%h${GIT_LOG_FIELD_SEP}%s${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%ae${GIT_LOG_FIELD_SEP}%aI${GIT_LOG_RECORD_SEP}`,
      "--shortstat",
    ],
    GIT_HISTORY_MAX_BUFFER,
  );

  const commits: GitCommitSummary[] = [];
  let current: GitCommitSummary | null = null;
  for (const line of output.split("\n")) {
    if (line.includes(GIT_LOG_RECORD_SEP)) {
      if (current) commits.push(current);
      const [sha, shortSha, subject, authorName, authorEmail, authorDate] =
        line.replace(GIT_LOG_RECORD_SEP, "").split(GIT_LOG_FIELD_SEP);
      current = {
        sha: sha ?? "",
        shortSha: shortSha ?? "",
        subject: subject ?? "",
        authorName: authorName ?? "",
        authorEmail: authorEmail ?? "",
        authorDate: authorDate ?? "",
        fileCount: 0,
        insertions: 0,
        deletions: 0,
      };
    } else if (current && /files? changed/.test(line)) {
      const fileCount = /(\d+) files? changed/.exec(line);
      const insertions = /(\d+) insertions?\(\+\)/.exec(line);
      const deletions = /(\d+) deletions?\(-\)/.exec(line);
      current.fileCount = fileCount ? Number.parseInt(fileCount[1] ?? "0", 10) || 0 : 0;
      current.insertions = insertions ? Number.parseInt(insertions[1] ?? "0", 10) || 0 : 0;
      current.deletions = deletions ? Number.parseInt(deletions[1] ?? "0", 10) || 0 : 0;
    }
  }
  if (current) commits.push(current);
  return commits;
}

/** One `git show` read: meta record + name-status + numstat (two spawns). */
export async function getGitCommitDetail(cwd: string, sha: string): Promise<GitCommitDetail> {
  const repositoryRoot = await repositoryRootOf(cwd);
  const metaFormat = `--format=%H${GIT_LOG_FIELD_SEP}%P${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%ae${GIT_LOG_FIELD_SEP}%aI${GIT_LOG_FIELD_SEP}%s${GIT_LOG_RECORD_SEP}`;
  // git suppresses --numstat when --name-status is also given, so read the two
  // blocks in separate spawns and merge them by path.
  const [metaOut, nameStatusOut, numstatOut] = await Promise.all([
    runGit(repositoryRoot, ["show", metaFormat, sha], GIT_HISTORY_MAX_BUFFER),
    runGit(repositoryRoot, ["show", "--format=", "--name-status", sha], GIT_HISTORY_MAX_BUFFER),
    runGit(repositoryRoot, ["show", "--format=", "--numstat", sha], GIT_HISTORY_MAX_BUFFER),
  ]);

  const meta = metaOut.split("\n")[0] ?? "";
  const [commitSha, parents, authorName, authorEmail, authorDate, subject] =
    meta.replace(GIT_LOG_RECORD_SEP, "").split(GIT_LOG_FIELD_SEP);

  const byPath = new Map<string, GitCommitFile>();
  const putFile = (path: string, fields: Partial<GitCommitFile>) => {
    const existing = byPath.get(path);
    if (existing) Object.assign(existing, fields);
    else byPath.set(path, { path, originalPath: null, status: "M", insertions: 0, deletions: 0, ...fields });
  };

  // name-status: `X\tpath` / `R100\told\tnew`
  for (const line of nameStatusOut.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    const lastPath = paths[paths.length - 1];
    if (!lastPath) continue;
    putFile(lastPath, {
      originalPath: paths.length > 1 ? paths[0] ?? null : null,
      status: status ?? "M",
    });
  }
  // numstat: `add\tdel\tpath[/old]` (binary files are `-\t-`)
  for (const line of numstatOut.split("\n")) {
    if (!line.trim()) continue;
    const [insertions, deletions, ...paths] = line.split("\t");
    const lastPath = paths[paths.length - 1];
    if (!lastPath) continue;
    putFile(lastPath, {
      insertions: insertions === "-" ? 0 : Number.parseInt(insertions ?? "0", 10) || 0,
      deletions: deletions === "-" ? 0 : Number.parseInt(deletions ?? "0", 10) || 0,
    });
  }

  return {
    sha: commitSha ?? sha,
    parents: (parents ?? "").split(" ").filter(Boolean),
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    authorDate: authorDate ?? "",
    subject: subject ?? "",
    files: [...byPath.values()],
  };
}

/** Unified patch for one commit — whole commit, or a single file when given. */
export async function getGitCommitDiff(
  cwd: string,
  sha: string,
  filePath?: string,
): Promise<{ patch: string } | { patch: null }> {
  try {
    const repositoryRoot = await repositoryRootOf(cwd);
    const args = filePath
      ? ["show", "--format=", "--unified=3", sha, "--", filePath]
      : ["show", "--format=", "--unified=3", sha];
    const patch = await runGit(repositoryRoot, args, GIT_HISTORY_MAX_BUFFER);
    return { patch };
  } catch {
    return { patch: null };
  }
}
