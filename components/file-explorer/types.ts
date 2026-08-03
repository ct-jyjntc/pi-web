/** Shared types for the sidebar file explorer tree and clipboard. */

import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

export type UploadPhase = "idle" | "checking" | "uploading";
export type UploadConflictStrategy = "error" | "overwrite" | "skip";

export interface UploadError {
  name: string;
  error: string;
}

export interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

export interface UploadSummary {
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

export interface PendingConflict {
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

/** Client-side clipboard for copy/cut → paste (paths only; FS work is on paste). */
export interface FileClipboard {
  mode: "copy" | "cut";
  sourcePath: string;
  name: string;
  isDir: boolean;
}

export type DraftKind = "file" | "folder";

export interface ExplorerDraft {
  parentPath: string;
  kind: DraftKind;
  /** depth of the parent row (draft renders as child). */
  depth: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  /** null = blank area / root of the explorer */
  target: FileNode | null;
}

export type { GitFileStatus, GitFileStatusKind, GitStatusResponse };
