/**
 * Client fetch helpers for the file explorer (list / git / upload / mutations).
 * Single owner for /api/files explorer calls from the UI.
 */
import { encodeFilePathForApi, joinFilePath } from "@/lib/file-paths";
import type { GitStatusResponse } from "@/lib/git-types";
import type {
  FileEntry,
  FileNode,
  UploadConflictStrategy,
  UploadResponse,
} from "./types";
import { apiFetch } from "@/lib/api-transport";

export async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await apiFetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) {
    let message = `Failed to load files (HTTP ${res.status})`;
    try {
      const data = await res.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

export async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd, fresh: "1" });
  const res = await apiFetch(`/api/git/status?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
}

export function uploadFiles(
  targetDirectory: string,
  files: File[],
  strategy: UploadConflictStrategy,
  msg: (key: "files.uploadNetworkError" | "files.uploadCancelled") => string,
  onProgress: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error(msg("files.uploadNetworkError")));
    xhr.onabort = () => reject(new Error(msg("files.uploadCancelled")));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

async function postFileOp(
  targetPath: string,
  type: string,
  body?: Record<string, unknown>,
): Promise<{ path?: string; name?: string }> {
  const res = await apiFetch(`/api/files/${encodeFilePathForApi(targetPath)}?type=${type}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({})) as { error?: string; path?: string; name?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  return data;
}

export function createFile(parentPath: string, name: string) {
  return postFileOp(parentPath, "create", { name });
}

export function createFolder(parentPath: string, name: string) {
  return postFileOp(parentPath, "mkdir", { name });
}

export function renamePath(targetPath: string, name: string) {
  return postFileOp(targetPath, "rename", { name });
}

export function deletePath(targetPath: string) {
  return postFileOp(targetPath, "delete");
}

export function copyPath(sourcePath: string, destination: string) {
  return postFileOp(sourcePath, "copy", { destination });
}

export function movePath(sourcePath: string, destination: string) {
  return postFileOp(sourcePath, "move", { destination });
}
