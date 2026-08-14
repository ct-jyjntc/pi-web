/**
 * Unified agent mode shared by the RPC wrapper (server) and the chat UI
 * (client). Combines the tool set (plan strips edit/write) with a permission
 * overlay into one global preference (persisted in pi-web.json).
 */
export type AgentMode = "ask" | "auto" | "plan" | "yolo";

export const AGENT_MODES: AgentMode[] = ["ask", "auto", "plan", "yolo"];

export function parseAgentMode(value: unknown): AgentMode {
  return value === "ask" || value === "auto" || value === "plan" || value === "yolo"
    ? value
    : "ask";
}

/** Plan mode runs read-only; ask/auto/yolo keep the full tool allow-list. */
export function agentModeStripsWriteTools(mode: AgentMode): boolean {
  return mode === "plan";
}

/** Only yolo flips the extension's global ask→allow rewrite. */
export function agentModeWantsYolo(mode: AgentMode): boolean {
  return mode === "yolo";
}

/**
 * Per-mode surface overrides layered on top of the user's own policy.
 *
 * These name *tool surfaces*, not files. The permission extension still runs
 * `path` and `external_directory` gates, so `edit: "allow"` still cannot touch a
 * `path`-denied file (`.env`, `~/.ssh`) and still prompts for writes outside
 * the working directory. That is what makes "auto" narrower than yolo: edits
 * land without a prompt, bash and outside-cwd access keep asking.
 *
 * A surface listed here replaces that surface in the base policy wholesale —
 * a mode is a coarse intent, not a pattern-level merge.
 */
export const AGENT_MODE_PERMISSION_OVERLAY: Record<AgentMode, Record<string, "allow" | "ask" | "deny">> = {
  // Untouched: the user's policy decides every surface.
  ask: {},
  // Auto-approve file mutations only.
  auto: { edit: "allow", write: "allow" },
  // Plan is owned by the tool strip + brief, not a permission deny overlay.
  plan: {},
  // yoloMode already rewrites every ask→allow; no surface overlay needed.
  yolo: {},
};

export function agentModePermissionOverlay(mode: AgentMode): Record<string, "allow" | "ask" | "deny"> {
  return AGENT_MODE_PERMISSION_OVERLAY[mode] ?? {};
}
