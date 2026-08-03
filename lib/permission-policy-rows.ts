/**
 * Flatten / rebuild permission policy maps as editable table rows.
 * Single owner for row↔JSON conversion used by PermissionsSettingsPanel.
 */
import type { PermissionAction, PermissionSurface } from "./permission-policy";

export type PermissionRuleRow = {
  /** Stable React key. */
  id: string;
  /** Surface name: "*", "bash", "path", "read", … */
  surface: string;
  /**
   * Pattern within the surface. Empty string means the whole surface is a
   * single action string (e.g. read: "allow").
   */
  pattern: string;
  action: PermissionAction;
  reason?: string;
};

export const COMMON_SURFACES = [
  "*",
  "path",
  "bash",
  "read",
  "write",
  "edit",
  "external_directory",
  "mcp",
  "skill",
  "task",
] as const;

export const PERMISSION_ACTIONS: PermissionAction[] = ["allow", "ask", "deny"];

let rowSeq = 0;
function nextId(): string {
  rowSeq += 1;
  return `pr-${rowSeq}-${Math.random().toString(36).slice(2, 7)}`;
}

function isAction(value: unknown): value is PermissionAction {
  return value === "allow" || value === "ask" || value === "deny";
}

function parseActionCell(
  value: unknown,
): { action: PermissionAction; reason?: string } | null {
  if (isAction(value)) return { action: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as { action?: unknown; reason?: unknown };
    if (isAction(rec.action)) {
      return {
        action: rec.action,
        reason: typeof rec.reason === "string" ? rec.reason : undefined,
      };
    }
  }
  return null;
}

/** Convert flat permission object → ordered table rows. */
export function permissionToRows(
  permission: Record<string, PermissionSurface> | null | undefined,
): PermissionRuleRow[] {
  if (!permission || typeof permission !== "object") return [];
  const rows: PermissionRuleRow[] = [];

  for (const [surface, value] of Object.entries(permission)) {
    if (!surface) continue;
    const asAction = parseActionCell(value);
    if (asAction) {
      rows.push({
        id: nextId(),
        surface,
        pattern: "",
        action: asAction.action,
        reason: asAction.reason,
      });
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [pattern, cell] of Object.entries(value as Record<string, unknown>)) {
        const parsed = parseActionCell(cell);
        if (!parsed) continue;
        rows.push({
          id: nextId(),
          surface,
          pattern,
          action: parsed.action,
          reason: parsed.reason,
        });
      }
    }
  }
  return rows;
}

/**
 * Rebuild permission object from rows.
 * - One row with empty pattern → `"surface": "action"`
 * - Otherwise → `"surface": { "pattern": "action", ... }` (insertion order)
 * Last row wins on duplicate surface+pattern.
 */
export function rowsToPermission(
  rows: PermissionRuleRow[],
): Record<string, PermissionSurface> {
  // surface → ordered pattern entries ("" key for whole-surface)
  const bySurface = new Map<string, Array<{ pattern: string; action: PermissionAction; reason?: string }>>();

  for (const row of rows) {
    const surface = row.surface.trim();
    if (!surface) continue;
    if (!isAction(row.action)) continue;
    const pattern = row.pattern.trim();
    const list = bySurface.get(surface) ?? [];
    // Replace existing same pattern
    const idx = list.findIndex((e) => e.pattern === pattern);
    const entry = {
      pattern,
      action: row.action,
      reason: row.reason?.trim() || undefined,
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    bySurface.set(surface, list);
  }

  const out: Record<string, PermissionSurface> = {};
  for (const [surface, list] of bySurface) {
    if (list.length === 1 && list[0]!.pattern === "") {
      const only = list[0]!;
      out[surface] = only.reason
        ? { action: only.action, reason: only.reason }
        : only.action;
      continue;
    }
    const map: Record<string, PermissionAction | { action: PermissionAction; reason?: string }> = {};
    for (const e of list) {
      const key = e.pattern === "" ? "*" : e.pattern;
      map[key] = e.reason ? { action: e.action, reason: e.reason } : e.action;
    }
    out[surface] = map;
  }
  return out;
}

export function emptyRuleRow(partial?: Partial<PermissionRuleRow>): PermissionRuleRow {
  return {
    id: nextId(),
    surface: partial?.surface ?? "bash",
    pattern: partial?.pattern ?? "*",
    action: partial?.action ?? "ask",
    reason: partial?.reason,
  };
}

/** Validate rows before save; returns error message or null. */
export function validatePermissionRows(rows: PermissionRuleRow[]): string | null {
  if (rows.length === 0) return "Add at least one rule";
  for (const row of rows) {
    if (!row.surface.trim()) return "Every rule needs a surface (e.g. bash, path, *)";
    if (!isAction(row.action)) return `Invalid action on ${row.surface}`;
  }
  return null;
}
