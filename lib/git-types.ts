export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
  /** Has staged (index) changes */
  staged: boolean;
  /** Has unstaged worktree changes or is untracked */
  unstaged: boolean;
  insertions: number;
  deletions: number;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
}

export interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  stagedCount: number;
  unstagedCount: number;
  conflictCount: number;
  insertions: number;
  deletions: number;
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}

export interface GitMutationResponse {
  ok: true;
  status: GitStatusResponse;
}

export interface GitCommitResponse {
  ok: true;
  commit: string | null;
  status: GitStatusResponse;
}
