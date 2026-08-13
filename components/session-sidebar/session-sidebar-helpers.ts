/**
 * Pure helpers for the session sidebar (tree build, time buckets, unread ids).
 */
import type { SessionInfo } from "@/lib/types";
import type { MessageKey } from "@/lib/i18n/messages";

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

export const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

export function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

export function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** True when both sets hold exactly the same ids — lets us keep the previous Set
 *  identity so an unchanged SSE frame does not re-render the whole session list. */
export function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}


/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
export function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

export type ProjectActivity = { running: boolean; unread: boolean };

/** Per-project running/unread for the workspace selector (worktrees collapse to projectRoot). */
export function getProjectActivity(
  sessions: SessionInfo[],
  runningIds: Set<string>,
  unreadIds: Set<string>,
): Map<string, ProjectActivity> {
  const byRoot = new Map<string, ProjectActivity>();
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const running = runningIds.has(s.id);
    const unread = unreadIds.has(s.id);
    if (!running && !unread) continue;
    const prev = byRoot.get(root);
    if (!prev) {
      byRoot.set(root, { running, unread });
      continue;
    }
    if (running) prev.running = true;
    if (unread) prev.unread = true;
  }
  return byRoot;
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */

export function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}


export type SessionTimeBucket = "today" | "yesterday" | "week" | "month" | "older";

export const SESSION_TIME_BUCKETS: SessionTimeBucket[] = ["today", "yesterday", "week", "month", "older"];

export function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Bucket edges as epoch timestamps so bucketing a session is pure number math. */
export interface SessionTimeBounds {
  todayTs: number;
  yesterdayTs: number;
  weekTs: number;
  monthTs: number;
}

/**
 * Compute the four bucket edges once per grouping pass instead of allocating
 * ~7 Date objects per session. Every edge is still the start of a natural LOCAL
 * day (same semantics as startOfLocalDay + setDate, DST shifts included), so
 * bucket membership across midnight is unchanged.
 */
export function getSessionTimeBounds(now: Date = new Date()): SessionTimeBounds {
  const today = startOfLocalDay(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  return {
    todayTs: today.getTime(),
    yesterdayTs: new Date(year, month, day - 1).getTime(),
    weekTs: new Date(year, month, day - 7).getTime(),
    monthTs: new Date(year, month, day - 30).getTime(),
  };
}

export function getSessionTimeBucket(modified: string, bounds: SessionTimeBounds): SessionTimeBucket {
  const ts = Date.parse(modified);
  if (!Number.isFinite(ts)) return "older";
  if (ts >= bounds.todayTs) return "today";
  if (ts >= bounds.yesterdayTs) return "yesterday";
  if (ts >= bounds.weekTs) return "week";
  if (ts >= bounds.monthTs) return "month";
  return "older";
}

export function groupSessionTreeByTime(
  roots: SessionTreeNode[],
  bounds: SessionTimeBounds = getSessionTimeBounds(),
): Array<{ bucket: SessionTimeBucket; nodes: SessionTreeNode[] }> {
  const map = new Map<SessionTimeBucket, SessionTreeNode[]>();
  for (const b of SESSION_TIME_BUCKETS) map.set(b, []);
  for (const node of roots) {
    map.get(getSessionTimeBucket(node.session.modified, bounds))!.push(node);
  }
  return SESSION_TIME_BUCKETS
    .map((bucket) => ({ bucket, nodes: map.get(bucket)! }))
    .filter((g) => g.nodes.length > 0);
}

export function sessionTimeBucketLabel(
  bucket: SessionTimeBucket,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  switch (bucket) {
    case "today": return t("sidebar.groupToday");
    case "yesterday": return t("sidebar.groupYesterday");
    case "week": return t("sidebar.groupPast7Days");
    case "month": return t("sidebar.groupPast30Days");
    case "older": return t("sidebar.groupOlder");
  }
}


