/**
 * Global agent mode preference (pi-web.json agentMode) + permission yoloMode sync.
 * Single owner for the cross-session / restart-stable mode; sessions and UI call this.
 */
import {
  agentModeWantsFullPermission,
  parseAgentMode,
  type AgentMode,
} from "./agent-mode";
import { getPermissionMode, setPermissionMode } from "./permission-mode";
import { getRegistry } from "./rpc-registry";
import { readWebSettings, writeWebSettings } from "./web-settings";

/** Read the last selected agent mode from disk (defaults to ask). */
export function readGlobalAgentMode(): AgentMode {
  try {
    return parseAgentMode(readWebSettings().agentMode);
  } catch {
    return "ask";
  }
}

/** Keep permission yoloMode + live session wrappers aligned with agentMode. */
export function syncGlobalAgentModeEffects(mode: AgentMode): void {
  const next = parseAgentMode(mode);
  try {
    const current = getPermissionMode();
    const wantsFull = agentModeWantsFullPermission(next);
    if (wantsFull && !current.yoloMode) setPermissionMode("full");
    if (!wantsFull && current.yoloMode) setPermissionMode("ask");
  } catch {
    // Permission write must never fail the caller's mode switch.
  }
  try {
    for (const peer of getRegistry().values()) {
      if (peer.isAlive()) peer.applyModeLocally(next);
    }
  } catch {
    // Registry may be unavailable during early boot; next start reads disk.
  }
}

/**
 * Persist agent mode to pi-web.json and keep permission + live wrappers in lockstep.
 * Permission-system extension hot-reads yoloMode on the next before_agent_start.
 */
export function persistGlobalAgentMode(mode: AgentMode): AgentMode {
  const next = parseAgentMode(mode);
  try {
    writeWebSettings({ agentMode: next });
  } catch {
    // Preference write must never fail the caller's mode switch.
  }
  syncGlobalAgentModeEffects(next);
  return next;
}
