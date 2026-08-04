/**
 * Single owner for Pi Web permission *policy config* (read/write/validate).
 *
 * Enforcement stays in @gotgenes/pi-permission-system — this module only owns
 * the flat config file the extension already loads:
 *   ~/.pi/agent/extensions/pi-permission-system/config.json
 *
 * Two documents, one direction of flow:
 *   - **base policy** — what the user authors in the settings editor. Lives in
 *     the Pi Web sidecar (`~/.pi/agent/pi-permissions.jsonc`) because the
 *     extension's config schema is a `strictObject`: any Pi Web-specific key
 *     added to config.json would make the whole scope fail closed.
 *   - **effective policy** — base + the current AgentMode overlay, written to
 *     config.json. Derived, never hand-edited.
 *
 * AgentMode therefore composes rather than gating twice: `auto` layers
 * `edit/write: allow` over the base, `plan` layers `edit/write: deny`, and only
 * `yolo` sets the extension's global `yoloMode` ask→allow rewrite.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "./agent-dir";
import {
  agentModePermissionOverlay,
  agentModeWantsYolo,
  parseAgentMode,
  type AgentMode,
} from "./agent-mode";

export type PermissionAction = "allow" | "ask" | "deny";

/** OpenCode-compatible flat permission map (string or pattern object). */
export type PermissionSurface =
  | PermissionAction
  | { action: PermissionAction; reason?: string }
  | Record<string, PermissionAction | { action: PermissionAction; reason?: string }>;

export type PermissionPolicyDocument = {
  yoloMode?: boolean;
  debugLog?: boolean;
  permissionReviewLog?: boolean;
  permission?: Record<string, PermissionSurface>;
  [key: string]: unknown;
};

export const PERMISSION_POLICY_SCHEMA_HINT =
  "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json";

/** Safe default template (least privilege + common secrets). */
export function defaultPermissionPolicy(): PermissionPolicyDocument {
  return {
    yoloMode: false,
    permissionReviewLog: true,
    permission: {
      "*": "ask",
      path: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        "*.env.example": "allow",
        "**/.ssh/**": "deny",
      },
      read: "allow",
      bash: {
        "*": "ask",
        "git status": "allow",
        "git diff*": "allow",
        "git log*": "allow",
        "rm -rf *": "deny",
        "sudo *": "deny",
      },
      external_directory: "ask",
    },
  };
}

export function getPermissionPolicyPath(): string {
  return join(getAgentDir(), "extensions", "pi-permission-system", "config.json");
}

/** Pi Web sidecar: the user's base policy + the mode knobs mirrored for it. */
export function getLegacyPermissionModePath(): string {
  return join(getAgentDir(), "pi-permissions.jsonc");
}

/** Shape of the Pi Web-owned sidecar (never read by the extension). */
type SidecarDocument = {
  yoloMode?: boolean;
  agentMode?: string;
  basePermission?: Record<string, PermissionSurface>;
  [key: string]: unknown;
};

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function readSidecar(): SidecarDocument {
  return readJsonObject(getLegacyPermissionModePath()) as SidecarDocument;
}

/** The mode the enforced config was last composed for. */
export function readPolicyAgentMode(): AgentMode {
  return parseAgentMode(readSidecar().agentMode);
}

/**
 * Layer the mode's surface overrides over the user's base policy.
 * A listed surface replaces the base surface wholesale — see
 * AGENT_MODE_PERMISSION_OVERLAY for why that coarseness is intended.
 */
export function composeEffectivePermission(
  base: Record<string, PermissionSurface>,
  mode: AgentMode,
): Record<string, PermissionSurface> {
  return { ...base, ...agentModePermissionOverlay(mode) };
}

/**
 * Read the *base* policy — what the settings editor shows and saves.
 *
 * Prefers the sidecar. Falls back to whatever is in config.json (the pre-split
 * layout, where config.json held the user's policy directly) and finally to the
 * safe defaults. `yoloMode` is reported from the enforced config so callers see
 * the value actually in force.
 */
export function readPermissionPolicy(): {
  path: string;
  exists: boolean;
  policy: PermissionPolicyDocument;
} {
  const path = getPermissionPolicyPath();
  const exists = existsSync(path);
  const enforced = exists ? (readJsonObject(path) as PermissionPolicyDocument) : null;
  const sidecar = readSidecar();

  const base =
    sidecar.basePermission ??
    // Migration: before the base/effective split the enforced file *was* the
    // base, and no overlay had ever been written into it.
    enforced?.permission ??
    defaultPermissionPolicy().permission!;

  return {
    path,
    exists,
    policy: {
      ...(enforced ?? defaultPermissionPolicy()),
      permission: base,
      yoloMode: (enforced?.yoloMode ?? sidecar.yoloMode) === true,
    },
  };
}

/**
 * Persist a user-authored policy: the base goes to the sidecar, the composed
 * effective document to the extension config the enforcement layer reads.
 */
export function writePermissionPolicy(
  policy: PermissionPolicyDocument,
  modeOverride?: AgentMode,
): { path: string; policy: PermissionPolicyDocument } {
  const path = getPermissionPolicyPath();
  const sidecar = readSidecar();
  const mode = modeOverride ?? parseAgentMode(sidecar.agentMode);
  const base = policy.permission ?? sidecar.basePermission ?? defaultPermissionPolicy().permission!;
  // yoloMode is derived, never authored: AgentMode is its single owner, so a
  // stale value echoed back by the settings editor cannot desync the two.
  const yoloMode = agentModeWantsYolo(mode);

  const next: PermissionPolicyDocument = {
    ...policy,
    yoloMode,
    permission: composeEffectivePermission(base, mode),
  };
  writeJsonAtomic(path, next);

  // Sidecar keeps the un-overlaid policy so switching modes is reversible.
  writeJsonAtomic(getLegacyPermissionModePath(), {
    ...sidecar,
    yoloMode,
    agentMode: mode,
    basePermission: base,
  } satisfies SidecarDocument);

  // Callers edit the base, so hand it back rather than the derived document.
  return { path, policy: { ...next, permission: base } };
}

/** Recompose the enforced config for `mode` without touching the base policy. */
export function applyAgentModeToPermissionPolicy(mode: AgentMode): PermissionPolicyDocument {
  return writePermissionPolicy(readPermissionPolicy().policy, mode).policy;
}

/**
 * Re-derive the enforced config when it was composed for a different mode.
 *
 * Covers upgrades from the layout where `auto` set `yoloMode: true`: without
 * this, someone who never re-picks a mode keeps running the old, fully
 * permissive config while the composer chip reads "auto". Returns whether a
 * rewrite happened. No-ops on a fresh install that has no policy state yet.
 */
export function reconcilePermissionPolicyMode(mode: AgentMode): boolean {
  const sidecar = readSidecar();
  const hasBase = sidecar.basePermission !== undefined;
  if (!hasBase && !existsSync(getPermissionPolicyPath())) return false;
  if (hasBase && parseAgentMode(sidecar.agentMode) === mode) return false;
  applyAgentModeToPermissionPolicy(mode);
  return true;
}

/** Ensure a real config file exists (install default template once). */
export function ensurePermissionPolicyFile(): {
  path: string;
  created: boolean;
  policy: PermissionPolicyDocument;
} {
  const path = getPermissionPolicyPath();
  const sidecar = readSidecar();
  if (existsSync(path) && sidecar.basePermission) {
    return { path, created: false, policy: readPermissionPolicy().policy };
  }
  // Missing config, or a pre-split install with no sidecar base yet: seed the
  // base from whatever the user already had and recompose for the live mode.
  const { policy } = readPermissionPolicy();
  const created = !existsSync(path);
  return {
    path,
    created,
    policy: writePermissionPolicy(policy, parseAgentMode(sidecar.agentMode)).policy,
  };
}
