/**
 * AgentMode bridge for yoloMode (ask vs full auto-approve of "ask" rules).
 * Fine-grained allow/ask/deny policy lives in permission-policy.ts → extension config.
 */
import {
  getLegacyPermissionModePath,
  getPermissionPolicyPath,
  readPermissionPolicy,
  setPermissionPolicyYoloMode,
} from "./permission-policy";

export type PermissionMode = "ask" | "full";

export interface PermissionModeState {
  mode: PermissionMode;
  yoloMode: boolean;
  /** Legacy path kept for API compatibility; enforcement reads extension config. */
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
  const yoloMode = mode === "full";
  setPermissionPolicyYoloMode(yoloMode);
  return {
    mode,
    yoloMode,
    configPath: getLegacyPermissionModePath(),
    policyPath: getPermissionPolicyPath(),
  };
}
