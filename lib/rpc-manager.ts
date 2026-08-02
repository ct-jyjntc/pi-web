/**
 * Public façade for in-process AgentSession RPC.
 * Implementation is split: rpc-session-wrapper, rpc-registry, rpc-session-start.
 */

import { ensureSubagentSpawnEnv } from "./resolve-pi-cli";
import { ensureBuiltinPackages, migrateBuiltinPackageSettings } from "./ensure-builtin-packages";
import { ensureSubagentDelegation } from "./ensure-subagent-delegation";

// If packages spawn the Pi CLI, never use Electron as process.execPath.
ensureSubagentSpawnEnv();
ensureSubagentDelegation();
// Strip legacy settings.packages entries before any session can start.
for (const note of migrateBuiltinPackageSettings()) console.log(`[pi-web] ${note}`);
void ensureBuiltinPackages();

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
