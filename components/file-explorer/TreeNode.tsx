"use client";

/**
 * One expandable row in the file explorer tree (file or directory).
 */
import { useCallback, useEffect, useState } from "react";
import { AtSign, ChevronRight, Download, Loader2 } from "lucide-react";
import {
  encodeFilePathForApi,
  getRelativeFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import { useLocale } from "@/hooks/useLocale";
import { getFileIcon, FolderIcon } from "../FileIcons";
import { Icon } from "../Icon";
import { fetchEntries } from "./api";
import { DraftRow } from "./DraftRow";
import type {
  ExplorerDraft,
  FileNode,
  GitFileStatus,
  GitFileStatusKind,
} from "./types";

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "var(--text-muted)",
  added: "var(--success)",
  deleted: "var(--destructive)",
  renamed: "var(--text)",
  untracked: "var(--success)",
  conflict: "var(--destructive)",
};

const GIT_STATUS_LABEL_KEYS: Record<
  GitFileStatusKind,
  "files.modified" | "files.added" | "files.deleted" | "files.renamed" | "files.untracked" | "files.conflict"
> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

function MentionIcon({ size = 11 }: { size?: number }) {
  return <Icon icon={AtSign} size={size} strokeWidth={2.2} />;
}

interface Props {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  renamingPath: string | null;
  renameBusy: boolean;
  renameError: string | null;
  onRenameSubmit: (path: string, name: string) => void;
  onRenameCancel: () => void;
  draft: ExplorerDraft | null;
  draftBusy: boolean;
  draftError: string | null;
  onDraftSubmit: (name: string) => void;
  onDraftCancel: () => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  cutPath: string | null;
}

export function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  changedDirectoryPaths,
  renamingPath,
  renameBusy,
  renameError,
  onRenameSubmit,
  onRenameCancel,
  draft,
  draftBusy,
  draftError,
  onDraftSubmit,
  onDraftCancel,
  onContextMenu,
  cutPath,
}: Props) {
  const { t } = useLocale();
  const open = expandedPaths.has(node.fullPath);
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const isRenaming = renamingPath === node.fullPath;
  const isCut = cutPath === node.fullPath;
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // listing errors surface on root; child failures stay quiet
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  useEffect(() => {
    if (open && loaded) {
      void loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // When a draft targets this directory, force-expand and load children.
  useEffect(() => {
    if (draft?.parentPath === node.fullPath && node.isDir) {
      if (!open) onToggleExpanded(node.fullPath, true);
      if (!loaded) void loadChildren();
    }
  }, [draft, node.fullPath, node.isDir, open, loaded, loadChildren, onToggleExpanded]);

  useEffect(() => {
    if (isRenaming) setRenameValue(node.name);
  }, [isRenaming, node.name]);

  const handleClick = useCallback(() => {
    if (isRenaming) return;
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) void loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [isRenaming, node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded]);

  const showDraftHere = draft?.parentPath === node.fullPath && node.isDir && open;

  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event, node);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: "pointer",
          background: hovered || isRenaming ? "var(--bg-hover)" : "transparent",
          borderRadius: "var(--radius-xs)",
          userSelect: "none",
          opacity: isCut ? 0.45 : 1,
        }}
      >
        {node.isDir && (
          <Icon
            icon={ChevronRight}
            size={10}
            style={{
              flexShrink: 0,
              color: "var(--text-dim)",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.1s",
            }}
          />
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>

        {isRenaming ? (
          <input
            className="input-base"
            value={renameValue}
            disabled={renameBusy}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                const next = renameValue.trim();
                if (next && next !== node.name) onRenameSubmit(node.fullPath, next);
                else onRenameCancel();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onRenameCancel();
              }
            }}
            onBlur={() => {
              if (renameBusy) return;
              const next = renameValue.trim();
              if (next && next !== node.name) onRenameSubmit(node.fullPath, next);
              else onRenameCancel();
            }}
            aria-label={t("common.rename")}
            style={{
              flex: 1,
              minWidth: 0,
              height: 20,
              padding: "0 6px",
              fontSize: 12,
              borderRadius: "var(--radius-xs)",
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={node.fullPath}
          >
            {node.name}
          </span>
        )}

        {!isRenaming && highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", background: "var(--text-muted)" }}
          />
        )}
        {!isRenaming && !hovered && !node.isDir && gitStatus && (
          <span
            title={t(GIT_STATUS_LABEL_KEYS[gitStatus.status])}
            aria-label={t(GIT_STATUS_LABEL_KEYS[gitStatus.status])}
            style={{
              width: 14,
              flexShrink: 0,
              color: GIT_STATUS_COLORS[gitStatus.status],
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {gitStatus.code}
          </span>
        )}
        {!isRenaming && !hovered && containsGitChanges && (
          <span
            title={t("files.containsChanged")}
            aria-label={t("files.containsChanged")}
            style={{
              width: 6,
              height: 6,
              flexShrink: 0,
              borderRadius: "50%",
              background: "var(--text-muted)",
            }}
          />
        )}
        {loading && (
          <Icon icon={Loader2} size={10} strokeWidth={2} style={{ color: "var(--text-dim)", animation: "spin 0.8s linear infinite" }} />
        )}
        {!isRenaming && onAtMention && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            style={{
              position: "absolute",
              right: !node.isDir ? 28 : 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xs)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <MentionIcon />
            mention
          </button>
        )}
        {!isRenaming && hovered && !node.isDir && (
          <a
            href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
            download
            onClick={(e) => e.stopPropagation()}
            title={t("files.download")}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 5px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xs)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            <Icon icon={Download} size={11} strokeWidth={2.2} />
          </a>
        )}
      </div>

      {isRenaming && renameError && (
        <div
          style={{
            paddingLeft: 8 + (depth + 1) * 14,
            paddingRight: 8,
            fontSize: 10,
            color: "var(--destructive)",
            lineHeight: 1.3,
          }}
        >
          {renameError}
        </div>
      )}

      {node.isDir && open && (
        <div>
          {showDraftHere && draft && (
            <DraftRow
              kind={draft.kind}
              depth={depth + 1}
              defaultName={draft.kind === "folder" ? "new-folder" : "untitled.txt"}
              busy={draftBusy}
              error={draftError}
              onSubmit={onDraftSubmit}
              onCancel={onDraftCancel}
            />
          )}
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              gitStatusByPath={gitStatusByPath}
              changedDirectoryPaths={changedDirectoryPaths}
              renamingPath={renamingPath}
              renameBusy={renameBusy}
              renameError={renameError}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              draft={draft}
              draftBusy={draftBusy}
              draftError={draftError}
              onDraftSubmit={onDraftSubmit}
              onDraftCancel={onDraftCancel}
              onContextMenu={onContextMenu}
              cutPath={cutPath}
            />
          ))}
          {children.length === 0 && loaded && !showDraftHere && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}
