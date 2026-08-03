/**
 * Active-session navigation bridge so ContextPanel (and similar chrome) can
 * call navigateToLeaf without prop-drilling through AppShell — same pattern as
 * compact-action-store. ChatWindow registers handlers for the focused session.
 */
type SessionNavHandlers = {
  sessionId: string | null;
  navigateToLeaf: (leafId: string | null) => Promise<void> | void;
};

type Listener = () => void;

let handlers: SessionNavHandlers | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function setSessionNavHandlers(next: SessionNavHandlers | null): void {
  handlers = next;
  emit();
}

export function getSessionNavHandlers(): SessionNavHandlers | null {
  return handlers;
}

export function subscribeSessionNavHandlers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Navigate the active chat to leafId when the registered session matches.
 * Returns false when no matching handler is registered (caller may fall back).
 */
export async function requestNavigateToLeaf(
  sessionId: string,
  leafId: string | null,
): Promise<boolean> {
  if (!handlers?.navigateToLeaf || !handlers.sessionId) return false;
  if (handlers.sessionId !== sessionId) return false;
  await handlers.navigateToLeaf(leafId);
  return true;
}
