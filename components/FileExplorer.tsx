"use client";

/**
 * Sidebar file explorer: tree browse + upload + context-menu mutations
 * (new/rename/delete/copy path/copy/cut/paste). Mutations go through /api/files.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale } from "@/hooks/useLocale";
import { copyText } from "@/lib/clipboard";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import {
  copyPath,
  createFile,
  createFolder,
  deletePath,
  fetchEntries,
  fetchGitStatus,
  movePath,
  renamePath,
  uploadFiles,
} from "./file-explorer/api";
import {
  FileExplorerContextMenu,
  type ExplorerMenuAction,
} from "./file-explorer/ContextMenu";
import { DraftRow } from "./file-explorer/DraftRow";
import { TreeNode } from "./file-explorer/TreeNode";
import { UploadFeedback } from "./file-explorer/UploadFeedback";
import type {
  ContextMenuState,
  ExplorerDraft,
  FileClipboard,
  FileNode,
  GitFileStatus,
  PendingConflict,
  UploadPhase,
  UploadResponse,
  UploadSummary,
} from "./file-explorer/types";
import { apiFetch } from "@/lib/api-transport";

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(function FileExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
}, ref) {
  const { t } = useLocale();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [draft, setDraft] = useState<ExplorerDraft | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const prevCwdRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";

  const refreshTree = useCallback(() => {
    setTreeRefreshKey((key) => key + 1);
  }, []);

  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const applyUploadResult = useCallback((data: UploadResponse) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    setUploadSummary({ uploaded, skipped, errors });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map((name) => joinFilePath(cwd, name))));
      refreshTree();
    }
  }, [cwd, refreshTree]);

  const performUpload = useCallback(async (
    files: File[],
    strategy: "error" | "overwrite" | "skip",
  ) => {
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(cwd, files, strategy, (key) => t(key), setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(data);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult, cwd, t]);

  const prepareUpload = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploadBusy) return;
    setUploadSummary(null);
    setHighlightedPaths(new Set());
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const res = await apiFetch(
        `/api/files/${encodeFilePathForApi(cwd)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileNames: files.map((file) => file.name) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }

      await performUpload(files, "error");
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [cwd, performUpload, uploadBusy]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void prepareUpload(files);
  }, [prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker() {
      if (!uploadBusy) uploadInputRef.current?.click();
    },
  }), [uploadBusy]);

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    if (cwdChanged) {
      setExpandedPaths(new Set());
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
      setClipboard(null);
      setDraft(null);
      setRenamingPath(null);
      setContextMenu(null);
      setOpError(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)
      .then((status) => {
        if (!cancelled) setGitFiles(status.isGitRepository ? status.files : []);
      })
      .catch(() => {
        if (!cancelled) setGitFiles([]);
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  const startDraft = useCallback((parentPath: string, kind: "file" | "folder", depth: number) => {
    setContextMenu(null);
    setRenamingPath(null);
    setRenameError(null);
    setDraftError(null);
    setDraft({ parentPath, kind, depth });
    if (parentPath !== cwd) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(parentPath);
        return next;
      });
    }
  }, [cwd]);

  const handleDraftSubmit = useCallback(async (name: string) => {
    if (!draft || draftBusy) return;
    setDraftBusy(true);
    setDraftError(null);
    setOpError(null);
    try {
      if (draft.kind === "folder") await createFolder(draft.parentPath, name);
      else await createFile(draft.parentPath, name);
      setDraft(null);
      setHighlightedPaths(new Set([joinFilePath(draft.parentPath, name)]));
      refreshTree();
    } catch (failure) {
      setDraftError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setDraftBusy(false);
    }
  }, [draft, draftBusy, refreshTree]);

  const handleRenameSubmit = useCallback(async (targetPath: string, name: string) => {
    if (renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    setOpError(null);
    try {
      await renamePath(targetPath, name);
      setRenamingPath(null);
      if (clipboard?.sourcePath === targetPath) {
        setClipboard({
          ...clipboard,
          sourcePath: joinFilePath(getFileDirectory(targetPath), name),
          name,
        });
      }
      refreshTree();
    } catch (failure) {
      setRenameError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRenameBusy(false);
    }
  }, [clipboard, renameBusy, refreshTree]);

  const handleDelete = useCallback(async (node: FileNode) => {
    const label = node.isDir
      ? t("files.confirmDeleteFolder", { name: node.name })
      : t("files.confirmDeleteFile", { name: node.name });
    if (!window.confirm(label)) return;
    setOpError(null);
    try {
      await deletePath(node.fullPath);
      if (clipboard?.sourcePath === node.fullPath) setClipboard(null);
      if (renamingPath === node.fullPath) setRenamingPath(null);
      refreshTree();
    } catch (failure) {
      setOpError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [clipboard, renamingPath, refreshTree, t]);

  const handlePaste = useCallback(async (targetDir: string) => {
    if (!clipboard) return;
    setOpError(null);
    const destination = joinFilePath(targetDir, clipboard.name);
    try {
      if (clipboard.mode === "copy") {
        await copyPath(clipboard.sourcePath, destination);
      } else {
        await movePath(clipboard.sourcePath, destination);
        setClipboard(null);
      }
      setHighlightedPaths(new Set([destination]));
      if (targetDir !== cwd) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(targetDir);
          return next;
        });
      }
      refreshTree();
    } catch (failure) {
      setOpError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [clipboard, cwd, refreshTree]);

  const pasteDirectoryFor = useCallback((target: FileNode | null) => {
    if (!target) return cwd;
    if (target.isDir) return target.fullPath;
    return getFileDirectory(target.fullPath) || cwd;
  }, [cwd]);

  const menuItemsFor = useCallback((target: FileNode | null) => {
    const canPaste = clipboard != null;
    const isRoot = target == null;
    const isDir = isRoot || target.isDir;

    const items: Array<{
      id: ExplorerMenuAction;
      label: string;
      danger?: boolean;
      disabled?: boolean;
      separatorAfter?: boolean;
    }> = [];

    if (isDir) {
      items.push(
        { id: "newFile", label: t("files.newFile") },
        { id: "newFolder", label: t("files.newFolder"), separatorAfter: true },
      );
    }

    if (!isRoot) {
      items.push(
        { id: "rename", label: t("common.rename") },
        { id: "copy", label: t("files.copy") },
        { id: "cut", label: t("files.cut") },
      );
    }

    items.push({
      id: "paste",
      label: t("files.paste"),
      disabled: !canPaste,
      separatorAfter: true,
    });

    if (!isRoot) {
      items.push(
        { id: "copyRelativePath", label: t("files.copyRelativePath") },
        { id: "copyAbsolutePath", label: t("files.copyAbsolutePath"), separatorAfter: true },
      );
      if (!target!.isDir) {
        items.push({ id: "download", label: t("files.download") });
      }
      if (onAtMention) {
        items.push({ id: "mention", label: t("files.insertPath"), separatorAfter: true });
      }
      items.push({ id: "delete", label: t("common.delete"), danger: true });
    }

    return items;
  }, [clipboard, onAtMention, t]);

  const handleMenuAction = useCallback(async (action: ExplorerMenuAction) => {
    if (!contextMenu) return;
    const target = contextMenu.target;
    // New file/folder: into the folder row, or into the explorer root for blank-area menus.
    const parentForCreate = target?.isDir ? target.fullPath : cwd;

    setContextMenu(null);

    switch (action) {
      case "newFile":
        startDraft(parentForCreate, "file", 0);
        break;
      case "newFolder":
        startDraft(parentForCreate, "folder", 0);
        break;
      case "rename":
        if (target) {
          setRenameError(null);
          setRenamingPath(target.fullPath);
        }
        break;
      case "copy":
        if (target) {
          setClipboard({ mode: "copy", sourcePath: target.fullPath, name: target.name, isDir: target.isDir });
        }
        break;
      case "cut":
        if (target) {
          setClipboard({ mode: "cut", sourcePath: target.fullPath, name: target.name, isDir: target.isDir });
        }
        break;
      case "paste": {
        await handlePaste(pasteDirectoryFor(target));
        break;
      }
      case "copyRelativePath":
        if (target) {
          void copyText(getRelativeFilePath(target.fullPath, cwd)).catch(() => {});
        }
        break;
      case "copyAbsolutePath":
        if (target) {
          void copyText(target.fullPath).catch(() => {});
        }
        break;
      case "download":
        if (target && !target.isDir) {
          const a = document.createElement("a");
          a.href = `/api/files/${encodeFilePathForApi(target.fullPath)}?type=download`;
          a.download = target.name;
          a.click();
        }
        break;
      case "mention":
        if (target && onAtMention) {
          onAtMention(getRelativeFilePath(target.fullPath, cwd), target.isDir);
        }
        break;
      case "delete":
        if (target) void handleDelete(target);
        break;
    }
  }, [contextMenu, cwd, handleDelete, handlePaste, onAtMention, pasteDirectoryFor, startDraft]);

  const openContextMenu = useCallback((event: React.MouseEvent, node: FileNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, target: node });
  }, []);

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => getRelativeFilePath(joinFilePath(cwd, name), cwd)),
    );
  }, [cwd, onAtMentions, uploadSummary]);

  const rootDraft = draft?.parentPath === cwd ? draft : null;
  const cutPath = clipboard?.mode === "cut" ? clipboard.sourcePath : null;

  return (
    <div
      style={{ minHeight: "100%" }}
      onContextMenu={(event) => {
        // Blank area → root menu (don't override node menus that stopPropagation).
        openContextMenu(event, null);
      }}
    >
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />

      <UploadFeedback
        uploadPhase={uploadPhase}
        uploadProgress={uploadProgress}
        uploadError={uploadError}
        uploadSummary={uploadSummary}
        pendingConflict={pendingConflict}
        onOverwrite={() => pendingConflict && void performUpload(pendingConflict.files, "overwrite")}
        onSkip={() => pendingConflict && void performUpload(pendingConflict.files, "skip")}
        onCancelConflict={() => setPendingConflict(null)}
        onDismissError={() => setUploadError(null)}
        onDismissSummary={() => setUploadSummary(null)}
        onMentionUploaded={onAtMentions ? addUploadedFilesToChat : undefined}
      />

      {opError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "6px 8px",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            lineHeight: 1.35,
            color: "var(--destructive)",
          }}
        >
          <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{opError}</span>
          <button
            type="button"
            onClick={() => setOpError(null)}
            title={t("files.dismissError")}
            aria-label={t("files.dismissError")}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: "none",
              borderRadius: "var(--radius-xs)",
              background: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ padding: "2px 4px" }}>
        {loading ? (
          <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("files.loading")}</div>
        ) : error ? (
          <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--destructive)" }}>{error}</div>
        ) : (
          <>
            {rootDraft && (
              <DraftRow
                kind={rootDraft.kind}
                depth={0}
                defaultName={rootDraft.kind === "folder" ? "new-folder" : "untitled.txt"}
                busy={draftBusy}
                error={draftError}
                onSubmit={(name) => void handleDraftSubmit(name)}
                onCancel={() => { setDraft(null); setDraftError(null); }}
              />
            )}
            {roots.map((node) => (
              <TreeNode
                key={node.fullPath}
                node={node}
                depth={0}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                expandedPaths={expandedPaths}
                onToggleExpanded={handleToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                changedDirectoryPaths={changedDirectoryPaths}
                renamingPath={renamingPath}
                renameBusy={renameBusy}
                renameError={renameError}
                onRenameSubmit={(path, name) => void handleRenameSubmit(path, name)}
                onRenameCancel={() => { setRenamingPath(null); setRenameError(null); }}
                draft={draft}
                draftBusy={draftBusy}
                draftError={draftError}
                onDraftSubmit={(name) => void handleDraftSubmit(name)}
                onDraftCancel={() => { setDraft(null); setDraftError(null); }}
                onContextMenu={openContextMenu}
                cutPath={cutPath}
              />
            ))}
          </>
        )}
        {!loading && !error && roots.length === 0 && !rootDraft && (
          <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            {t("files.none")}
          </div>
        )}
      </div>

      {contextMenu && (
        <FileExplorerContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItemsFor(contextMenu.target)}
          onAction={(id) => void handleMenuAction(id)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});
