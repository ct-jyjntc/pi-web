/**
 * AgentMode bridge for the settings-page yolo toggle (ask vs full auto-approve).
 * Fine-grained allow/ask/deny policy lives in permission-policy.ts → extension config.
 *
 * The toggle and the composer's mode picker drive the same state, so flipping it
 * here moves `pi-web.json` agentMode and every live session wrapper too — before
 * the split they could disagree, showing "ask" in the composer while the enforced
 * policy was fully permissive.
 */
import { parseAgentMode } from "./agent-mode";
import { persistGlobalAgentMode, readGlobalAgentMode } from "./global-agent-mode";
import {
  getLegacyPermissionModePath,
  getPermissionPolicyPath,
  readPermissionPolicy,
} from "./permission-policy";

export type PermissionMode = "ask" | "full";

export interface PermissionModeState {
  mode: PermissionMode;
  yoloMode: boolean;
  /** Pi Web sidecar holding the base policy; enforcement reads extension config. */
  configPath: string;
  policyPath: string;
}

export function getPermissionMode(): PermissionModeState {
  const { policy } = readPermissionPolicy();
  const yoloMode = policy.yoloMode === true;
  return {
    mode: yoloMode ? "full" : "ask",
    yoloMode,
    configPath: getLegacyPermissionModePath(),
    policyPath: getPermissionPolicyPath(),
  };
}

export function setPermissionMode(mode: PermissionMode): PermissionModeState {
  // Turning the toggle off must not silently demote someone who is in auto or
  // plan — those already run with yolo off, so only "yolo" needs a fallback.
  const current = readGlobalAgentMode();
  const next = mode === "full"
    ? "yolo"
    : parseAgentMode(current === "yolo" ? "ask" : current);
  persistGlobalAgentMode(next);
  return getPermissionMode();
}
