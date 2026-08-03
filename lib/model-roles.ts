import {
  emptyModelRoles,
  formatModelRef,
  parseModelRoles,
  type ModelRef,
  type ModelRoles,
  type WebSettings,
} from "./web-settings";

export type ModelRole = "default" | "smol" | "plan";

export type { ModelRoles };
export { emptyModelRoles, parseModelRoles };


export function formatModelRoles(roles: ModelRoles | null | undefined): Record<ModelRole, string> {
  const r = roles ?? emptyModelRoles();
  return {
    default: formatModelRef(r.default),
    smol: formatModelRef(r.smol),
    plan: formatModelRef(r.plan),
  };
}

export function getModelRoles(settings: WebSettings): ModelRoles {
  return settings.modelRoles ?? emptyModelRoles();
}

export function getRoleModelRef(role: ModelRole, settings: WebSettings): ModelRef | null {
  return getModelRoles(settings)[role];
}

/**
 * Preference chain for a role when the explicit role model is unset or unavailable.
 * - default → settings.json default (caller)
 * - smol → commitModel → titleModel → default role
 * - plan → default role
 */
export function roleFallbackChain(role: ModelRole, settings: WebSettings): Array<ModelRef | null> {
  const roles = getModelRoles(settings);
  if (role === "default") return [roles.default];
  if (role === "smol") return [roles.smol, settings.commitModel, settings.titleModel, roles.default];
  return [roles.plan, roles.default];
}

/**
 * Format a role model for agent frontmatter (`provider/modelId`).
 * Returns null when unset so the agent inherits the parent model.
 */
export function formatRoleModelForAgent(role: ModelRole, settings: WebSettings): string | null {
  const ref = getRoleModelRef(role, settings);
  if (!ref) return null;
  const formatted = formatModelRef(ref);
  if (!formatted) return null;
  return ref.thinkingLevel && ref.thinkingLevel !== "auto" && ref.thinkingLevel !== "off"
    ? `${formatted}:${ref.thinkingLevel}`
    : formatted;
}
