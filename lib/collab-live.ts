/**
 * Collab-lite live read-only sharing: token → session file tail over SSE.
 */
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, type Stats } from "fs";
import { open, stat, type FileHandle } from "fs/promises";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type CollabShare = {
  token: string;
  sessionId: string;
  sessionFile?: string;
  note?: string;
  createdAt: string;
  mode: "read-only";
};

function storeDir(): string {
  const dir = join(getAgentDir(), "collab");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sharePath(token: string): string {
  return join(storeDir(), `${token}.json`);
}

/** Cap on the retained/served window of a session file. */
export const SESSION_WINDOW_MAX_BYTES = 2_000_000;
/**
 * Prefix bytes kept as a rewrite fingerprint (see prefixIntact). The head is
 * generous enough to cover the whole header record — that is the part a
 * re-parenting rewrite edits, and it can do so without changing the file size.
 */
const PREFIX_HEAD_BYTES = 1024;
const PREFIX_TAIL_BYTES = 64;
const NEWLINE = 0x0a;
const EMPTY = Buffer.alloc(0);

function copyOf(view: Buffer): Buffer {
  return view.byteLength === 0 ? EMPTY : Buffer.from(view);
}

/** Last `count` bytes of `prev` followed by `next`, copied out of the source buffers. */
function lastBytes(prev: Buffer, next: Buffer, count: number): Buffer {
  if (next.byteLength >= count) return copyOf(next.subarray(next.byteLength - count));
  const combined = Buffer.concat([prev, next]);
  return copyOf(combined.byteLength > count ? combined.subarray(combined.byteLength - count) : combined);
}

/** Fill `buffer` from `position`, tolerating short reads (file shrank mid-read). */
async function readInto(handle: FileHandle, buffer: Buffer, position: number): Promise<number> {
  let filled = 0;
  while (filled < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.byteLength - filled, position + filled);
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  return filled;
}

export function createCollabShare(input: {
  sessionId: string;
  sessionFile?: string;
  note?: string;
}): CollabShare {
  const token = createHash("sha256")
    .update(`${input.sessionId}:${Date.now()}:${randomBytes(8).toString("hex")}`)
    .digest("hex")
    .slice(0, 24);
  const share: CollabShare = {
    token,
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    note: input.note,
    createdAt: new Date().toISOString(),
    mode: "read-only",
  };
  writeFileSync(sharePath(token), `${JSON.stringify(share, null, 2)}\n`, "utf8");
  return share;
}

export function getCollabShare(token: string): CollabShare | null {
  const p = sharePath(token);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CollabShare;
  } catch {
    return null;
  }
}

export function readSessionSnapshot(sessionFile: string, maxBytes = SESSION_WINDOW_MAX_BYTES): {
  exists: boolean;
  size: number;
  mtimeMs: number;
  /** Full content when under maxBytes; otherwise last maxBytes (still large enough for long chats). */
  content: string;
  truncated: boolean;
  /** @deprecated use content */
  tail: string;
} {
  if (!sessionFile || !existsSync(sessionFile)) {
    return { exists: false, size: 0, mtimeMs: 0, content: "", truncated: false, tail: "" };
  }
  const st = statSync(sessionFile);
  const buf = readFileSync(sessionFile);
  const truncated = buf.byteLength > maxBytes;
  const slice = truncated ? buf.subarray(buf.byteLength - maxBytes) : buf;
  // If truncated mid-line, drop the first partial line so JSONL stays parseable.
  let text = slice.toString("utf8");
  if (truncated) {
    const nl = text.indexOf("\n");
    if (nl !== -1) text = text.slice(nl + 1);
  }
  return {
    exists: true,
    size: st.size,
    mtimeMs: st.mtimeMs,
    content: text,
    truncated,
    tail: text,
  };
}

export interface SessionTailState {
  exists: boolean;
  /** Bytes of the file folded into the reader (equals the file size in practice). */
  size: number;
  mtimeMs: number;
  /** True when older records were dropped to honor the window cap. */
  truncated: boolean;
}

export interface SessionTailPoll extends SessionTailState {
  /** True when anything observable changed since the previous poll. */
  changed: boolean;
  /** True when the window was rebuilt from scratch (first poll, or file rewritten). */
  reset: boolean;
  /** True when `lines` gained or dropped records. */
  linesChanged: boolean;
}

/**
 * Incremental reader for one session .jsonl.
 *
 * Session files are appended to constantly while an agent runs, so re-reading
 * the whole file (up to SESSION_WINDOW_MAX_BYTES) on a timer burns synchronous
 * fs time on the event loop for every viewer. This keeps a byte offset and reads
 * only what was appended since the previous poll, asynchronously.
 *
 * Sessions can also be *rewritten* wholesale (cascade re-parenting, pi's own
 * migrations both `writeFileSync` the entire file), which invalidates the
 * offset. Every incremental read therefore re-verifies that the prefix we
 * already consumed is unchanged and rebuilds the window when it is not, so a
 * viewer can never end up splicing new records onto a stale prefix.
 */
export class SessionTailReader {
  private readonly file: string;
  private readonly maxBytes: number;
  /** Retained records, oldest first, newline-free and never empty. */
  private window: string[] = [];
  /** Byte cost of each retained record (utf8 length + its newline). */
  private windowLineBytes: number[] = [];
  private windowBytes = 0;
  /** Bytes of the file already folded into `window` or `partial`. */
  private offset = 0;
  /** Trailing bytes after the last newline: a record that is still being written. */
  private partial: Buffer = EMPTY;
  /** File bytes [0, min(PREFIX_HEAD_BYTES, offset)) — rewrite fingerprint. */
  private head: Buffer = EMPTY;
  /** File bytes [max(0, offset - PREFIX_TAIL_BYTES), offset) — rewrite fingerprint. */
  private tail: Buffer = EMPTY;
  private size = 0;
  private mtimeMs = 0;
  private ino = -1;
  private dev = -1;
  private fileExists = false;
  private windowTruncated = false;
  private polled = false;

  constructor(file: string, maxBytes: number = SESSION_WINDOW_MAX_BYTES) {
    this.file = file;
    this.maxBytes = maxBytes;
  }

  /** Retained window, oldest record first. Serialize it; never mutate it. */
  get lines(): readonly string[] {
    return this.window;
  }

  async poll(): Promise<SessionTailPoll> {
    const first = !this.polled;
    this.polled = true;

    let st: Stats;
    try {
      st = await stat(this.file);
    } catch {
      // Gone (not yet created, or deleted): drop the window so viewers do not
      // keep rendering records that no longer exist.
      const existed = this.fileExists;
      this.clear();
      return { ...this.snapshot(), changed: first || existed, reset: existed, linesChanged: existed };
    }

    // Identity, size and mtime all unchanged: nothing to read. This is the
    // common case for the safety poll and for watch events fired by neighbours.
    if (this.fileExists
      && st.size === this.size
      && st.mtimeMs === this.mtimeMs
      && st.ino === this.ino
      && st.dev === this.dev) {
      return { ...this.snapshot(), changed: first, reset: false, linesChanged: false };
    }

    let handle: FileHandle;
    try {
      handle = await open(this.file, "r");
    } catch {
      // Raced with a delete/replace; keep the current window and retry later.
      return { ...this.snapshot(), changed: first, reset: false, linesChanged: false };
    }
    try {
      // fstat rather than the path stat above so size/mtime match the bytes read
      // through this descriptor.
      const fst = await handle.stat();
      const rewritten = !this.fileExists
        || fst.ino !== this.ino
        || fst.dev !== this.dev
        // Reaching here means size/mtime/identity moved. If the file did not grow
        // it was modified in place, i.e. rewritten — the only other way to change
        // a session file is appending to it.
        || fst.size <= this.offset
        || !(await this.prefixIntact(handle));
      return rewritten ? await this.reload(handle, fst) : await this.appendFrom(handle, fst, first);
    } catch {
      return { ...this.snapshot(), changed: first, reset: false, linesChanged: false };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  /**
   * Check that the prefix we already consumed still holds the same bytes. A
   * whole-file rewrite that ends up longer than `offset` keeps both the inode and
   * the size direction of a plain append, so the fingerprints are what separate
   * the two: the head covers the whole header record — the part cascade
   * re-parenting edits — and the tail moves as soon as anything before `offset`
   * changes length, which is what a reformatting migration does.
   *
   * The one shape this cannot see is a rewrite that grows the file, leaves the
   * header untouched, and swaps a middle record for one of exactly the same byte
   * length. Catching that would mean re-reading the whole prefix on every poll,
   * which is the cost this reader exists to avoid.
   */
  private async prefixIntact(handle: FileHandle): Promise<boolean> {
    if (this.offset === 0) return true;
    const headLength = this.head.byteLength;
    const tailLength = this.tail.byteLength;
    if (headLength === 0 || tailLength === 0) return false;
    const scratch = Buffer.allocUnsafe(Math.max(headLength, tailLength));
    const headView = scratch.subarray(0, headLength);
    if (await readInto(handle, headView, 0) !== headLength) return false;
    if (!headView.equals(this.head)) return false;
    const tailView = scratch.subarray(0, tailLength);
    if (await readInto(handle, tailView, this.offset - tailLength) !== tailLength) return false;
    return tailView.equals(this.tail);
  }

  /** Rebuild the whole window from the last `maxBytes` of the file. */
  private async reload(handle: FileHandle, st: Stats): Promise<SessionTailPoll> {
    const start = st.size > this.maxBytes ? st.size - this.maxBytes : 0;
    const length = st.size - start;
    let bytes = EMPTY;
    if (length > 0) {
      const buffer = Buffer.allocUnsafe(length);
      bytes = buffer.subarray(0, await readInto(handle, buffer, start));
    }

    // A cut window can start mid-record; drop that fragment so every emitted
    // line stays a parseable JSONL record.
    let from = 0;
    if (start > 0) {
      const firstNewline = bytes.indexOf(NEWLINE);
      from = firstNewline === -1 ? bytes.byteLength : firstNewline + 1;
    }
    const partialStart = Math.max(from, bytes.lastIndexOf(NEWLINE) + 1);

    this.window = [];
    this.windowLineBytes = [];
    this.windowBytes = 0;
    this.windowTruncated = start > 0;
    this.addRecords(bytes.subarray(from, partialStart));
    this.partial = copyOf(bytes.subarray(partialStart));
    this.offset = start + bytes.byteLength;
    this.head = start === 0
      ? copyOf(bytes.subarray(0, Math.min(PREFIX_HEAD_BYTES, bytes.byteLength)))
      : await this.readHead(handle);
    this.tail = lastBytes(EMPTY, bytes, PREFIX_TAIL_BYTES);
    this.fileExists = true;
    this.size = this.offset;
    this.mtimeMs = st.mtimeMs;
    this.ino = st.ino;
    this.dev = st.dev;
    return { ...this.snapshot(), changed: true, reset: true, linesChanged: true };
  }

  /** Fold the bytes appended since the previous poll into the window. */
  private async appendFrom(handle: FileHandle, st: Stats, first: boolean): Promise<SessionTailPoll> {
    this.mtimeMs = st.mtimeMs;
    const length = st.size - this.offset;
    if (length <= 0) {
      // Unreachable via poll() (a non-growing change is treated as a rewrite);
      // kept so this stays safe if it ever gains another caller.
      return { ...this.snapshot(), changed: first, reset: false, linesChanged: false };
    }

    const buffer = Buffer.allocUnsafe(length);
    const fresh = buffer.subarray(0, await readInto(handle, buffer, this.offset));
    const joined = this.partial.byteLength > 0 ? Buffer.concat([this.partial, fresh]) : fresh;
    const partialStart = joined.lastIndexOf(NEWLINE) + 1;
    const added = this.addRecords(joined.subarray(0, partialStart));
    this.partial = copyOf(joined.subarray(partialStart));
    const dropped = this.trimWindow();

    if (this.head.byteLength < PREFIX_HEAD_BYTES) {
      // head is short only while offset < PREFIX_HEAD_BYTES, so the fresh
      // bytes continue it directly.
      this.head = copyOf(Buffer.concat([this.head, fresh]).subarray(0, PREFIX_HEAD_BYTES));
    }
    this.tail = lastBytes(this.tail, fresh, PREFIX_TAIL_BYTES);
    this.offset += fresh.byteLength;
    this.size = this.offset;
    const linesChanged = added > 0 || dropped;
    return {
      ...this.snapshot(),
      changed: first || fresh.byteLength > 0,
      reset: false,
      linesChanged,
    };
  }

  private async readHead(handle: FileHandle): Promise<Buffer> {
    const buffer = Buffer.allocUnsafe(PREFIX_HEAD_BYTES);
    return copyOf(buffer.subarray(0, await readInto(handle, buffer, 0)));
  }

  /** Split a run of complete "…\n" records into the window; returns how many were added. */
  private addRecords(complete: Buffer): number {
    if (complete.byteLength === 0) return 0;
    // `complete` always ends with a newline, so the trailing split element is "".
    const parts = complete.toString("utf8").split("\n");
    let added = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      const line = parts[i];
      if (line.length === 0) continue;
      this.window.push(line);
      const bytes = Buffer.byteLength(line) + 1;
      this.windowLineBytes.push(bytes);
      this.windowBytes += bytes;
      added += 1;
    }
    return added;
  }

  /** Drop oldest records until the window fits the cap; returns true if any went. */
  private trimWindow(): boolean {
    if (this.windowBytes <= this.maxBytes) return false;
    let drop = 0;
    let freed = 0;
    while (this.windowBytes - freed > this.maxBytes && drop < this.window.length - 1) {
      freed += this.windowLineBytes[drop];
      drop += 1;
    }
    if (drop === 0) return false;
    // splice once instead of repeated shift(): one memmove for the whole batch.
    this.window.splice(0, drop);
    this.windowLineBytes.splice(0, drop);
    this.windowBytes -= freed;
    this.windowTruncated = true;
    return true;
  }

  private clear(): void {
    this.window = [];
    this.windowLineBytes = [];
    this.windowBytes = 0;
    this.offset = 0;
    this.partial = EMPTY;
    this.head = EMPTY;
    this.tail = EMPTY;
    this.size = 0;
    this.mtimeMs = 0;
    this.ino = -1;
    this.dev = -1;
    this.fileExists = false;
    this.windowTruncated = false;
  }

  private snapshot(): SessionTailState {
    return {
      exists: this.fileExists,
      size: this.size,
      mtimeMs: this.mtimeMs,
      truncated: this.windowTruncated,
    };
  }
}
