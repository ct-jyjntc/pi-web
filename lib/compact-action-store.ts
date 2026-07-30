/**
 * Registers the active session's compact handlers so ContextPanel (and others)
 * can trigger compaction without prop-drilling through AppShell.
 */
type CompactHandlers = {
  compact: () => void;
  abort?: () => void;
  isCompacting: boolean;
  error?: string | null;
  resultText?: string | null;
};

type Listener = () => void;

let handlers: CompactHandlers | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export function setCompactHandlers(next: CompactHandlers | null): void {
  handlers = next;
  emit();
}

export function getCompactHandlers(): CompactHandlers | null {
  return handlers;
}

export function subscribeCompactHandlers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestCompact(): boolean {
  if (!handlers || handlers.isCompacting) return false;
  handlers.compact();
  return true;
}
