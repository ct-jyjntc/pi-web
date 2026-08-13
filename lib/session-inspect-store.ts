/**
 * Sidebar session-menu bridge for the branches / system-prompt dialogs.
 * Avoids prop-drilling through SessionSidebar — same pattern as compact-action-store.
 */

export type SessionInspectKind = "branches" | "system";

export type SessionInspectRequest = {
  sessionId: string;
  kind: SessionInspectKind;
};

type Listener = () => void;

let current: SessionInspectRequest | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestSessionInspect(sessionId: string, kind: SessionInspectKind): void {
  current = { sessionId, kind };
  emit();
}

export function closeSessionInspect(): void {
  if (!current) return;
  current = null;
  emit();
}

export function getSessionInspect(): SessionInspectRequest | null {
  return current;
}

export function subscribeSessionInspect(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
