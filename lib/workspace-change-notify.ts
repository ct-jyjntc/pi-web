/**
 * Single owner for the "workspace files changed" UI signal.
 * Explorer / git review subscribe; write/edit tool completions notify.
 * Same debounce owner (AppShell explorerRefreshKey) as post-turn refresh.
 */

const WORKSPACE_MUTATING_TOOLS = new Set(["write", "edit"]);

const listeners = new Set<() => void>();

export function isWorkspaceMutatingTool(name: unknown): name is string {
  return typeof name === "string" && WORKSPACE_MUTATING_TOOLS.has(name);
}

export function notifyWorkspaceFilesChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeWorkspaceFilesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
