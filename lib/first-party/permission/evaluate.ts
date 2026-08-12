/**
 * Decide allow / ask / deny from the Pi Web permission policy.
 */
import { isAbsolute, relative, resolve, sep } from "path";
import {
  composeEffectivePermission,
  readPermissionPolicy,
  type PermissionAction,
  type PermissionSurface,
} from "../../permission-policy";
import { parseAgentMode, type AgentMode } from "../../agent-mode";
import { readGlobalAgentMode } from "../../global-agent-mode";
import { matchBashPattern, matchPathPattern, splitBashCommands } from "./match";

const ACTION_RANK = { deny: 2, ask: 1, allow: 0 } as const;

export function isOutsideCwd(cwd: string, filePath: string): boolean {
  const resolved = resolve(cwd, filePath);
  const cwdResolved = resolve(cwd);
  const rel = relative(cwdResolved, resolved);
  if (!rel) return false;
  if (isAbsolute(rel)) return true;
  return rel === ".." || rel.startsWith(`..${sep}`);
}

function mostRestrictive(
  matches: Array<{ action: PermissionAction; pattern: string; reason?: string }>,
): { action: PermissionAction; pattern: string; reason?: string } | null {
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) =>
    ACTION_RANK[b.action] - ACTION_RANK[a.action] || b.pattern.length - a.pattern.length,
  )[0]!;
}

export type PermissionDecision = {
  action: PermissionAction;
  surface: string;
  pattern: string;
  reason?: string;
};

type Hit = PermissionDecision & { score: number };

function asAction(value: unknown): { action: PermissionAction; reason?: string } | null {
  if (value === "allow" || value === "ask" || value === "deny") return { action: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as { action?: unknown; reason?: unknown };
    if (rec.action === "allow" || rec.action === "ask" || rec.action === "deny") {
      return {
        action: rec.action,
        reason: typeof rec.reason === "string" ? rec.reason : undefined,
      };
    }
  }
  return null;
}

function matchSurface(
  surface: PermissionSurface | undefined,
  candidate: string,
  kind: "bash" | "path" | "name",
): { action: PermissionAction; pattern: string; reason?: string } | null {
  if (surface === undefined) return null;
  const direct = asAction(surface);
  if (direct) return { ...direct, pattern: "" };

  if (!surface || typeof surface !== "object") return null;
  let best: { action: PermissionAction; pattern: string; reason?: string; score: number } | null = null;
  for (const [pattern, raw] of Object.entries(surface as Record<string, unknown>)) {
    const parsed = asAction(raw);
    if (!parsed) continue;
    const matched = pattern === "*"
      ? true
      : kind === "name"
        ? pattern === candidate
        : kind === "path"
          ? matchPathPattern(pattern, candidate)
          : matchBashPattern(pattern, candidate);
    if (!matched) continue;
    const score = pattern === "*" ? 0 : pattern.length;
    if (!best || score > best.score) best = { ...parsed, pattern, score };
  }
  return best;
}

function chooseBest(hits: Hit[]): PermissionDecision {
  const rank = ACTION_RANK;
  hits.sort((a, b) => b.score - a.score || rank[b.action] - rank[a.action]);
  const best = hits[0]!;
  return {
    action: best.action,
    surface: best.surface,
    pattern: best.pattern,
    reason: best.reason,
  };
}

function scoreOf(surface: string, pattern: string): number {
  if (surface === "*") return 0;
  if (!pattern || pattern === "*") return 10;
  return 100 + pattern.length;
}

function pushHit(
  hits: Hit[],
  surface: string,
  match: { action: PermissionAction; pattern: string; reason?: string } | null,
): void {
  if (!match) return;
  hits.push({
    action: match.action,
    surface,
    pattern: match.pattern,
    reason: match.reason,
    score: scoreOf(surface, match.pattern),
  });
}

export function extractToolPath(toolName: string, input: Record<string, unknown>): string | undefined {
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  if (Array.isArray(input.paths) && typeof input.paths[0] === "string") return input.paths[0];
  if (toolName === "edit" && typeof input.input === "string") {
    const header = input.input.match(/^\[(.+?)#[0-9A-Fa-f]{4}\]/);
    if (header?.[1]) return header[1];
  }
  return undefined;
}

export function extractBashCommand(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== "bash") return undefined;
  if (typeof input.command === "string") return input.command;
  if (typeof input.cmd === "string") return input.cmd;
  return undefined;
}

export function evaluatePermission(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  mode?: AgentMode;
}): PermissionDecision {
  const { policy } = readPermissionPolicy();
  const mode = input.mode ?? parseAgentMode(readGlobalAgentMode());
  const permission = composeEffectivePermission(policy.permission ?? {}, mode);
  const yolo = policy.yoloMode === true;

  const hits: Hit[] = [{
    action: asAction(permission["*"])?.action ?? "ask",
    surface: "*",
    pattern: "",
    score: 0,
  }];

  if (input.toolName !== "bash") {
    pushHit(hits, input.toolName, matchSurface(permission[input.toolName], input.toolName, "name"));
  }

  const command = extractBashCommand(input.toolName, input.toolInput);
  if (command) {
    const segments = splitBashCommands(command);
    const matches: Array<{ action: PermissionAction; pattern: string; reason?: string }> = [];
    for (const segment of segments) {
      const match = matchSurface(permission.bash, segment, "bash");
      if (match) matches.push(match);
    }
    if (segments.length > 1) {
      const full = matchSurface(permission.bash, command, "bash");
      if (full) matches.push(full);
    }
    pushHit(hits, "bash", mostRestrictive(matches));
  }

  const filePath = extractToolPath(input.toolName, input.toolInput);
  if (filePath) {
    const resolved = resolve(input.cwd, filePath);
    pushHit(
      hits,
      "path",
      matchSurface(permission.path, resolved, "path") ?? matchSurface(permission.path, filePath, "path"),
    );
    if (isOutsideCwd(input.cwd, filePath)) {
      const ext = matchSurface(permission.external_directory, resolved, "path");
      if (ext) {
        pushHit(hits, "external_directory", ext);
      }
    }
  }

  const decision = chooseBest(hits);
  if (yolo && decision.action === "ask") {
    return { ...decision, action: "allow", reason: decision.reason ?? "yolo" };
  }
  return decision;
}
