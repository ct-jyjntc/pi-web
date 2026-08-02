/**
 * Lightweight running-session snapshot for list/poll routes.
 *
 * Intentionally does NOT import `rpc-manager` (or the pi SDK / tool graph).
 * The registry Map is owned by rpc-manager and stored on globalThis so this
 * module can read it with a structural type — without redeclaring the global
 * (which would clash with rpc-manager's AgentSessionWrapper typing).
 */

type RunningSessionLike = {
  sessionId?: string;
  isRunning?: () => boolean;
};

type SessionsGlobal = typeof globalThis & {
  __piSessions?: Map<string, RunningSessionLike>;
};

/** Session ids currently streaming / compacting / running a prompt or bash. */
export function getRunningRpcSessionIds(): string[] {
  const registry = (globalThis as SessionsGlobal).__piSessions;
  if (!registry || registry.size === 0) return [];

  const ids = new Set<string>();
  for (const [sessionId, session] of registry) {
    try {
      if (session?.isRunning?.()) {
        ids.add(session.sessionId || sessionId);
      }
    } catch {
      // Defensive: a half-destroyed wrapper must not break the list route.
    }
  }
  return [...ids];
}
