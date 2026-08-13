/**
 * Session-process snapshot store for hashline stale-tag recovery.
 *
 * Reads and successful edits record whole-file text under [path#TAG]. When a
 * later edit arrives with a stale TAG (typical: parallel tool calls on the
 * same file after the first write advanced the fingerprint), recovery looks
 * up the tagged snapshot and remaps line anchors by unique content match —
 * Hermes-style content anchoring without dropping the hashline protocol.
 */
import { resolve, isAbsolute } from "path";

export type HashlineSnapshot = {
  tag: string;
  text: string;
  recordedAt: number;
};

/** Newest-first version history per absolute path. */
const versionsByPath = new Map<string, HashlineSnapshot[]>();

/** Per-path serial queue so parallel same-file edits recover in order. */
const pathGates = new Map<string, Promise<void>>();

const MAX_VERSIONS_PER_PATH = 12;

export function canonicalHashlinePath(cwd: string, pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
}

/**
 * Record a whole-file snapshot under its 4-hex tag. Dedupes identical head
 * (same tag + same text) so parallel reads don't thrash the ring buffer.
 */
export function recordHashlineSnapshot(absPath: string, text: string, tag: string): void {
  const key = absPath;
  const normalizedTag = tag.toUpperCase();
  const history = versionsByPath.get(key) ?? [];
  const head = history[0];
  if (head && head.tag === normalizedTag && head.text === text) {
    head.recordedAt = Date.now();
    return;
  }
  // If same tag exists deeper (content collision on 16-bit hash), replace that
  // entry so recovery always sees the latest text for the tag.
  const withoutTag = history.filter((v) => v.tag !== normalizedTag);
  const next: HashlineSnapshot[] = [
    { tag: normalizedTag, text, recordedAt: Date.now() },
    ...withoutTag,
  ].slice(0, MAX_VERSIONS_PER_PATH);
  versionsByPath.set(key, next);
}

/** Lookup snapshot text for a path+tag pair (undefined when never recorded). */
export function getHashlineSnapshot(absPath: string, tag: string): string | undefined {
  const history = versionsByPath.get(absPath);
  if (!history) return undefined;
  return history.find((v) => v.tag === tag.toUpperCase())?.text;
}

/** Test helper — drop all retained snapshots. */
export function clearHashlineSnapshots(): void {
  versionsByPath.clear();
}


/**
 * Serialize async work per absolute path. Parallel edit tool calls on the same
 * file become a queue so the second call sees the first write and can recover.
 */
export async function withHashlinePathLock<T>(
  absPath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev = pathGates.get(absPath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const chained = prev.then(() => gate);
  pathGates.set(absPath, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (pathGates.get(absPath) === chained) {
      pathGates.delete(absPath);
    }
  }
}

/** Acquire multiple path locks in sorted order (deadlock-safe). */
export async function withHashlinePathsLocked<T>(
  absPaths: string[],
  fn: () => Promise<T> | T,
): Promise<T> {
  const unique = [...new Set(absPaths.filter(Boolean))].sort();
  let i = 0;
  const run = async (): Promise<T> => {
    if (i >= unique.length) return await fn();
    const path = unique[i++]!;
    return withHashlinePathLock(path, run);
  };
  return run();
}
