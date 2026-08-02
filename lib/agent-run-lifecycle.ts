/**
 * Timing and phase names for the agent prompt run lifecycle.
 * Single owner for settle / grace / reconcile intervals — see
 * docs/superpowers/specs/2026-08-02-agent-run-lifecycle.md.
 */

/** Client UI phases for a user-owned prompt run (not bash-only). */
export type AgentRunPhase =
  | "idle"
  | "prompting"
  | "streaming"
  | "settling"
  | "grace";

/** Delay before the first settlement poll after end evidence. */
export const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
/** Interval between settlement polls while the run is still busy. */
export const PROMPT_SETTLE_POLL_MS = 1_500;
/** Cap on settlement polling duration for one run. */
export const PROMPT_SETTLE_MAX_MS = 20_000;

/** Keep SSE open briefly after UI settlement so late extension events can arrive. */
export const EVENT_STREAM_IDLE_GRACE_MS = 30_000;

/**
 * Slow backup reconcile while agentRunning and settlement is not already polling.
 * Audit before delete — path #4 in the lifecycle doc.
 */
export const AGENT_STATE_RECONCILE_MS = 15_000;

/** Bash-only idle recovery poll interval. */
export const BASH_STATE_RECONCILE_MS = 1_000;

export const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5_000;
export const EVENT_STREAM_RECONNECT_BASE_MS = 1_000;
export const EVENT_STREAM_RECONNECT_MAX_MS = 15_000;
export const EVENT_STREAM_RECONNECT_MAX_ATTEMPTS = 6;
