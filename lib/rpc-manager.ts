/**
 * Public façade for in-process AgentSession RPC.
 * Implementation is split: rpc-session-wrapper, rpc-registry, rpc-session-start.
 *
 * Importing this module must stay side-effect free. Bootstrapping (env, builtin
 * packages) runs once from startRpcSession / deferred boot — otherwise a light
 * GET that only needs getRpcSession() would pull ensureBuiltinPackages and stall
 * the heavy runtime for seconds on first click.
 */

export type { AgentEvent } from "./rpc-session-wrapper";
export { AgentSessionWrapper } from "./rpc-session-wrapper";
export {
  getRpcSession,
  hasBusyRpcSessionForCwd,
  destroyRpcSessionsForCwd,
  destroyIdleRpcSessions,
} from "./rpc-registry";
export { startRpcSession } from "./rpc-session-start";
// Re-export the thin snapshot helper so existing call sites keep working.
// Implementation lives in rpc-running.ts so list/poll routes can avoid this module.
export { getRunningRpcSessionIds } from "./rpc-running";
