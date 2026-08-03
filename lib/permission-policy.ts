/**
 * Single owner for Pi Web permission *policy config* (read/write/validate).
 *
 * Enforcement stays in @gotgenes/pi-permission-system — this module only owns
 * the flat config file the extension already loads:
 *   ~/.pi/agent/extensions/pi-permission-system/config.json
 *
 * AgentMode still toggles yoloMode via permission-mode.ts; both write the same
 * on-disk document (policy merges, never a second gate).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "./agent-dir";

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

/** Legacy yolo-only file still written by permission-mode.ts. */
export function getLegacyPermissionModePath(): string {
  return join(getAgentDir(), "pi-permissions.jsonc");
}

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

/**
 * Read effective policy. Prefer extension config.json; fall back to defaults
 * merged with legacy yoloMode from pi-permissions.jsonc.
 */
export function readPermissionPolicy(): {
  path: string;
  exists: boolean;
  policy: PermissionPolicyDocument;
} {
  const path = getPermissionPolicyPath();
  const exists = existsSync(path);
  if (exists) {
    const obj = readJsonObject(path);
    return { path, exists: true, policy: obj as PermissionPolicyDocument };
  }

  const legacy = readJsonObject(getLegacyPermissionModePath());
  const base = defaultPermissionPolicy();
  if (legacy.yoloMode === true) base.yoloMode = true;
  return { path, exists: false, policy: base };
}

/**
 * Write full policy document to the extension config path (enforcement source of truth).
 * Also mirrors yoloMode into legacy pi-permissions.jsonc so AgentMode stays in sync.
 */
export function writePermissionPolicy(
  policy: PermissionPolicyDocument,
): { path: string; policy: PermissionPolicyDocument } {
  const path = getPermissionPolicyPath();
  const next: PermissionPolicyDocument = {
    ...policy,
    // Ensure permission object is present when callers only toggle knobs.
    permission: policy.permission ?? defaultPermissionPolicy().permission,
  };
  writeJsonAtomic(path, next);

  // Mirror yoloMode for permission-mode / AgentMode readers.
  const legacyPath = getLegacyPermissionModePath();
  const legacy = readJsonObject(legacyPath);
  writeJsonAtomic(legacyPath, {
    ...legacy,
    yoloMode: next.yoloMode === true,
  });

  return { path, policy: next };
}

/** Ensure a real config file exists (install default template once). */
export function ensurePermissionPolicyFile(): {
  path: string;
  created: boolean;
  policy: PermissionPolicyDocument;
} {
  const path = getPermissionPolicyPath();
  if (existsSync(path)) {
    return { path, created: false, policy: readJsonObject(path) as PermissionPolicyDocument };
  }
  const { policy } = writePermissionPolicy(defaultPermissionPolicy());
  // Re-apply legacy yolo if user already had full mode.
  const legacy = readJsonObject(getLegacyPermissionModePath());
  if (legacy.yoloMode === true) {
    return {
      path,
      created: true,
      policy: writePermissionPolicy({ ...policy, yoloMode: true }).policy,
    };
  }
  return { path, created: true, policy };
}

/**
 * Update only yoloMode on the extension config (AgentMode bridge).
 * Creates the file with defaults if missing.
 */
export function setPermissionPolicyYoloMode(yoloMode: boolean): PermissionPolicyDocument {
  const { policy } = readPermissionPolicy();
  return writePermissionPolicy({ ...policy, yoloMode }).policy;
}
