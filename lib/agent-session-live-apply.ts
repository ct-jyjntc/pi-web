/**
 * Apply optional live-agent snapshot fields to React setters without
 * overwriting properties the server left unset. Shared by loadSession,
 * settlement, and reconcile so all readers use one shape.
 */

import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import type { ContextUsage } from "@/lib/pi-types";
import { parseAgentMode, type AgentMode } from "@/lib/agent-mode";
import type { SessionProjections } from "@/lib/session-projections";
import { setSessionStatsMetric, setTodosMetric } from "@/lib/session-metrics-store";

export type ThinkingLevelOption =
  | "auto"
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type AgentStateResponse = {
  contextUsage?: ContextUsage | null;
  systemPrompt?: string | null;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  /** Unified agent mode (ask/auto/plan/yolo) from the RPC wrapper. */
  mode?: AgentMode;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
  projections?: SessionProjections;
};

export type QueuedMessages = {
  steering: string[];
  followUp: string[];
};

export function normalizeQueuedMessages(
  q?: { steering?: string[]; followUp?: string[] } | null,
): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function queuedMessagesEqual(a: QueuedMessages, b: QueuedMessages): boolean {
  return sameStringList(a.steering, b.steering) && sameStringList(a.followUp, b.followUp);
}

type LiveContextUsage = ContextUsage | null;

/** Host chrome is process-wide — skip writes from an unmounted hook or a stale sid. */
export function canApplySessionProjections(
  mounted: boolean,
  currentSessionId?: string | null,
  expectedSessionId?: string | null,
): boolean {
  if (!mounted) return false;
  if (expectedSessionId != null && currentSessionId !== expectedSessionId) return false;
  return true;
}

/** Write host-folded todos + token usage into the chrome metrics store. */
export function applySessionProjections(
  projections: SessionProjections | undefined | null,
  mounted = true,
  currentSessionId?: string | null,
  expectedSessionId?: string | null,
): void {
  if (!canApplySessionProjections(mounted, currentSessionId, expectedSessionId)) return;
  if (!projections) return;
  setTodosMetric(projections.todos);
  setSessionStatsMetric(projections.tokenUsage);
}

/** Apply optional live-agent state fields without overwriting unset properties. */
export function applyLiveAgentStateFields(
  liveState: AgentStateResponse | undefined | null,
  setters: {
    setContextUsage: (v: LiveContextUsage) => void;
    setSystemPrompt: (v: string | null) => void;
    setThinkingLevel?: (v: ThinkingLevelOption) => void;
    setSessionMode?: (v: AgentMode) => void;
    setExtensionStatuses: (v: ExtensionStatusItem[]) => void;
    setExtensionWidgets: (v: ExtensionWidgetItem[]) => void;
    setQueuedMessages?: (v: QueuedMessages) => void;
  },
  mounted = true,
  currentSessionId?: string | null,
  expectedSessionId?: string | null,
): void {
  if (!liveState) return;
  if (liveState.contextUsage !== undefined) {
    setters.setContextUsage(liveState.contextUsage ?? null);
  } else if (liveState.projections?.contextPressure !== undefined) {
    setters.setContextUsage(liveState.projections.contextPressure);
  }
  applySessionProjections(liveState.projections, mounted, currentSessionId, expectedSessionId);
  if (liveState.systemPrompt !== undefined) setters.setSystemPrompt(liveState.systemPrompt ?? null);
  if (liveState.thinkingLevel !== undefined && setters.setThinkingLevel) {
    setters.setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
  }
  if (liveState.mode !== undefined && setters.setSessionMode) {
    setters.setSessionMode(parseAgentMode(liveState.mode));
  }
  if (liveState.extensionStatuses !== undefined) {
    setters.setExtensionStatuses(liveState.extensionStatuses ?? []);
  }
  if (liveState.extensionWidgets !== undefined) {
    setters.setExtensionWidgets(liveState.extensionWidgets ?? []);
  }
  if (liveState.queuedMessages !== undefined && setters.setQueuedMessages) {
    setters.setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
  }
}

export function clampThinkingLevelForModel(
  current: ThinkingLevelOption,
  supported: string[] | undefined,
): ThinkingLevelOption {
  if (current === "auto") return "auto";
  if (!supported || supported.length === 0) return "auto";
  if (supported.includes(current)) return current;
  // Prefer a sensible default on the new model, else first supported, else auto.
  for (const prefer of ["medium", "low", "high", "off"] as const) {
    if (supported.includes(prefer)) return prefer;
  }
  const first = supported[0];
  if (
    first === "off"
    || first === "minimal"
    || first === "low"
    || first === "medium"
    || first === "high"
    || first === "xhigh"
    || first === "max"
  ) {
    return first;
  }
  return "auto";
}
