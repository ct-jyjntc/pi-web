/**
 * Hashline edit engine for Pi Web.
 *
 * Patch language (parsed by hashline-parse.ts) — preferred default for `edit`:
 *    [path/to/file.ts#A1B2]
 *    SWAP 10.=12:   (PUT 10.=12: is an alias)
 *    +const x = 1
 *    DEL 20         (CUT 20 is an alias)
 *    INS.POST 30:
 *    +// note
 * TAG is a 4-hex fingerprint of the whole normalized file (must match on-disk).
 *
 * Hunk mode — `{ path, hunks: [{ hash?, oldText, newText }] }` with optional
 * per-block sha1[:12] guards.
 *
 * Successful applies return a compact [path#NEWTAg] + N:line preview so the
 * next edit can re-ground without a full re-read.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";
import { checkSourceSyntax, formatSyntaxGuardFailure } from "./edit-syntax-guard";
import { resolveBlockRange } from "./hashline-block";
import {
  mergeHashlineSections,
  parseHashlinePatch,
  type PatchOp,
} from "./hashline-parse";
import { buildHashlinePreview, buildUnifiedDiff } from "./hashline-preview";
import { tryExtendShortSwaps } from "./hashline-repair";
import {
  getHashlineSnapshot,
  recordHashlineSnapshot,
} from "./hashline-snapshots";

export { resolveBlockRange } from "./hashline-block";
export { mergeHashlineSections, parseHashlinePatch } from "./hashline-parse";
export { buildHashlinePreview, buildUnifiedDiff } from "./hashline-preview";

export type HashlineHunk = {
  /** Optional explicit hash of the old block (sha1 first 12 hex of normalized oldText). */
  hash?: string;
  oldText: string;
  newText: string;
};

export type HashlineResult = {
  path: string;
  applied: number;
  hashes: string[];
  /** New 4-hex file tag after write (patch mode). */
  tag?: string;
  /** Tag that was validated before write. */
  oldTag?: string;
  summary?: string;
  /** Unified diff for chat UI (SplitPatchView). */
  diff?: string;
  /** Alias of diff for presentation.patch / patchFromToolDetails. */
  patch?: string;
  /** Human notes e.g. SWAP.BLK 1 → lines 1-4 */
  resolved?: string[];
  /** Soft size discipline signal for agents (not an error). */
  largeFileWarning?: string;
  /** Compact [path#TAG] + N:line preview (post-edit numbers) for the next call. */
  preview?: string;
};

/** Soft cap aligned with AGENTS.md size discipline — warn, do not block. */
export const LARGE_FILE_LINE_WARN = 800;

/** Line count for soft-warn (trailing empty from final newline does not inflate). */
export function countContentLines(content: string): number {
  if (!content) return 0;
  const normalized = content.replace(/\r\n/g, "\n");
  if (normalized === "") return 0;
  const parts = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return parts.length;
}

export function largeFileEditWarning(displayPath: string, content: string): string | undefined {
  const lines = countContentLines(content);
  if (lines < LARGE_FILE_LINE_WARN) return undefined;
  return (
    `Note: ${displayPath} is ~${lines} lines (≥${LARGE_FILE_LINE_WARN}). ` +
    `Prefer extract-module before stacking multi-hunk patches on this hot file.`
  );
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Per-block hash used by hunk mode. */
export function hashBlock(text: string): string {
  return createHash("sha1").update(normalize(text)).digest("hex").slice(0, 12);
}

/**
 * File-level 4-hex tag (omp-style length). Uses sha1 so we don't depend on Bun xxHash.
 * Trailing spaces/tabs/CR stripped per line before hashing (matches omp normalize intent).
 */
export function computeFileTag(text: string): string {
  const normalized = normalize(text).replace(/[ \t]+(?=\n|$)/g, "");
  return createHash("sha1").update(normalized).digest("hex").slice(0, 4).toUpperCase();
}

function resolvePath(cwd: string, pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
}

/** Absolute paths a hashline patch will mutate (section headers + MV dest). */
export function collectHashlineLockPaths(cwd: string, input: string): string[] {
  const { sections } = parseHashlinePatch(input);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string) => {
    const abs = resolvePath(cwd, value);
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  };
  for (const section of sections) {
    add(section.path);
    for (const op of section.ops) {
      if (op.kind === "mv") add(op.dest);
    }
  }
  return out.sort();
}

function assertNoOverlap(
  ranges: Array<{ start: number; end: number; label: string }>,
  where: string,
): void {
  const ordered = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const curr = ordered[i]!;
    if (prev.end > curr.start) {
      throw new Error(
        `${prev.label} and ${curr.label} overlap in ${where}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }
}

function displayPath(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

function preserveLineEndings(original: string, lfContent: string): string {
  if (original.includes("\r\n")) return lfContent.replace(/\n/g, "\r\n");
  return lfContent;
}

/**
 * Apply hashline hunks. Each oldText must match uniquely after LF normalization.
 * If hash is provided, it must match hashBlock(oldText) (guards stale model anchors).
 */
export function applyHashlineEdits(
  cwd: string,
  pathValue: string,
  hunks: HashlineHunk[],
): HashlineResult {
  if (!hunks.length) throw new Error("No hunks provided");
  const abs = resolvePath(cwd, pathValue);
  if (!existsSync(abs)) throw new Error(`File not found: ${pathValue}`);
  const original = readFileSync(abs, "utf8");
  const content = normalize(original);
  const hashes: string[] = [];

  type Planned = { start: number; end: number; newText: string; hash: string; index: number };
  const planned: Planned[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]!;
    const oldText = normalize(hunk.oldText);
    const newText = normalize(hunk.newText);
    if (!oldText) throw new Error(`hunks[${i}].oldText must not be empty`);
    const h = hashBlock(oldText);
    if (hunk.hash && hunk.hash !== h) {
      throw new Error(
        `hunks[${i}] hash mismatch: provided ${hunk.hash}, actual ${h}. Re-read the file and use fresh anchors.`,
      );
    }
    const first = content.indexOf(oldText);
    if (first === -1) {
      throw new Error(`hunks[${i}] oldText not found (hash=${h}). Re-read the file.`);
    }
    const second = content.indexOf(oldText, first + 1);
    if (second !== -1) {
      throw new Error(`hunks[${i}] oldText is not unique (hash=${h}). Add more context.`);
    }
    planned.push({ start: first, end: first + oldText.length, newText, hash: h, index: i });
    hashes.push(h);
  }

  assertNoOverlap(
    planned.map((p) => ({ start: p.start, end: p.end, label: `hunks[${p.index}]` })),
    pathValue,
  );

  planned.sort((a, b) => b.start - a.start);
  let next = content;
  for (const p of planned) {
    next = next.slice(0, p.start) + p.newText + next.slice(p.end);
  }

  const rel = displayPath(cwd, abs);
  const syntax = checkSourceSyntax(abs, next, cwd);
  if (!syntax.ok) {
    throw new Error(formatSyntaxGuardFailure(rel, syntax, next));
  }

  writeFileSync(abs, preserveLineEndings(original, next), "utf8");
  const newTag = computeFileTag(next);
  const oldTag = computeFileTag(content);
  const before = content.endsWith("\n") ? content : `${content}\n`;
  const after = next.endsWith("\n") ? next : `${next}\n`;
  const diff = buildUnifiedDiff(rel, before, after);
  const largeFileWarning = largeFileEditWarning(rel, next);
  return {
    path: abs,
    applied: planned.length,
    hashes,
    oldTag,
    tag: newTag,
    diff,
    patch: diff,
    largeFileWarning,
    summary:
      `Applied ${planned.length} hashline hunk(s) to ${rel} → #${newTag}` +
      (largeFileWarning ? `\n${largeFileWarning}` : ""),
  };
}

function joinNumberedLines(numbered: string[], hadTrailingNl: boolean): string {
  let nextLf = numbered.join("\n");
  if ((hadTrailingNl || numbered.length > 0) && numbered.length > 0 && !nextLf.endsWith("\n")) {
    nextLf += "\n";
  }
  return nextLf;
}

function materializeOps(
  lines: string[],
  ops: PatchOp[],
): { concrete: PatchOp[]; resolved: string[] } {
  const concrete: PatchOp[] = [];
  const resolved: string[] = [];
  for (const op of ops) {
    if (op.kind === "swap_blk") {
      const r = resolveBlockRange(lines, op.line);
      concrete.push({ kind: "swap", start: r.start, end: r.end, body: op.body });
      resolved.push(`SWAP.BLK ${op.line} → lines ${r.start}-${r.end} (${r.method})`);
      continue;
    }
    if (op.kind === "del_blk") {
      const r = resolveBlockRange(lines, op.line);
      concrete.push({ kind: "del", start: r.start, end: r.end });
      resolved.push(`DEL.BLK ${op.line} → lines ${r.start}-${r.end} (${r.method})`);
      continue;
    }
    if (op.kind === "ins_blk_post") {
      const r = resolveBlockRange(lines, op.line);
      concrete.push({ kind: "ins", at: "post", line: r.end, body: op.body });
      resolved.push(`INS.BLK.POST ${op.line} → after line ${r.end} (${r.method})`);
      continue;
    }
    concrete.push(op);
  }
  return { concrete, resolved };
}

function applyOpsToLines(lines: string[], ops: PatchOp[]): string[] {
  // Apply in reverse line order so earlier numbers stay valid.
  // First expand to a list of concrete mutations with original line anchors.
  type Mut =
    | { type: "replace"; start: number; end: number; body: string[] }
    | { type: "insert"; index: number; body: string[] } // insert before index (0-based)
    | { type: "delete_all" };

  const muts: Mut[] = [];
  for (const op of ops) {
    if (op.kind === "rem") {
      muts.push({ type: "delete_all" });
      continue;
    }
    if (op.kind === "mv" || op.kind === "swap_blk" || op.kind === "del_blk" || op.kind === "ins_blk_post") {
      // should be materialized already
      continue;
    }
    if (op.kind === "swap") {
      muts.push({ type: "replace", start: op.start, end: op.end, body: op.body });
      continue;
    }
    if (op.kind === "del") {
      muts.push({ type: "replace", start: op.start, end: op.end, body: [] });
      continue;
    }
    if (op.kind === "ins") {
      if (op.at === "head") muts.push({ type: "insert", index: 0, body: op.body });
      else if (op.at === "tail") muts.push({ type: "insert", index: lines.length, body: op.body });
      else if (op.at === "pre") muts.push({ type: "insert", index: (op.line ?? 1) - 1, body: op.body });
      else muts.push({ type: "insert", index: op.line ?? lines.length, body: op.body }); // post: after line N → index N
    }
  }

  if (muts.some((m) => m.type === "delete_all")) return [];

  // Validate ranges against original line count
  for (const m of muts) {
    if (m.type === "replace") {
      if (m.start < 1 || m.end > lines.length) {
        throw new Error(
          `Line range ${m.start}.=${m.end} out of bounds (file has ${lines.length} lines). Re-read the file.`,
        );
      }
    }
    if (m.type === "insert") {
      if (m.index < 0 || m.index > lines.length) {
        throw new Error(`Insert index ${m.index} out of bounds (file has ${lines.length} lines).`);
      }
    }
  }

  const replaces = muts.filter((m): m is Extract<typeof m, { type: "replace" }> => m.type === "replace");
  assertNoOverlap(
    replaces.map((m) => ({ start: m.start, end: m.end, label: `SWAP/DEL ${m.start}.=${m.end}` })),
    "this file",
  );
  for (const replace of replaces) {
    for (const mut of muts) {
      if (mut.type !== "insert") continue;
      if (replace.start - 1 < mut.index && mut.index < replace.end) {
        throw new Error(
          `Insert at ${mut.index} overlaps SWAP/DEL ${replace.start}.=${replace.end} in this file. Merge them into one edit or target disjoint regions.`,
        );
      }
    }
  }

  // Sort: higher start/index first; replaces before inserts at same point
  muts.sort((a, b) => {
    const ai = a.type === "replace" ? a.start : a.type === "insert" ? a.index + 0.5 : 0;
    const bi = b.type === "replace" ? b.start : b.type === "insert" ? b.index + 0.5 : 0;
    return bi - ai;
  });

  let next = lines.slice();
  for (const m of muts) {
    if (m.type === "replace") {
      next = [...next.slice(0, m.start - 1), ...m.body, ...next.slice(m.end)];
    } else if (m.type === "insert") {
      next = [...next.slice(0, m.index), ...m.body, ...next.slice(m.index)];
    }
  }
  return next;
}

/** Split normalized LF text into editor lines (drop trailing empty from final newline). */
export function splitNumberedLines(lf: string): { numbered: string[]; hadTrailingNl: boolean } {
  const lines = lf.length === 0 ? [] : lf.split("\n");
  const hadTrailingNl = lf.endsWith("\n");
  const numbered =
    hadTrailingNl && lines.length > 0 && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;
  return { numbered, hadTrailingNl };
}

/** First unique 0-based start of needle in haystack, or null if missing/ambiguous. */
function findUniqueBlock(haystack: string[], needle: string[]): number | null {
  if (needle.length === 0 || needle.length > haystack.length) return null;
  let found: number | null = null;
  const first = needle[0]!;
  const max = haystack.length - needle.length;
  for (let i = 0; i <= max; i++) {
    if (haystack[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (found !== null) return null;
    found = i;
  }
  return found;
}

function findUniqueLineIndexes(haystack: string[], line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    if (haystack[i] === line) out.push(i);
  }
  return out;
}

/**
 * Remap concrete ops from a tagged snapshot onto live lines by unique content
 * anchors (Hermes-style). Returns null when any anchor is missing/ambiguous.
 */
export function remapOpsFromSnapshot(
  snapshotLines: string[],
  liveLines: string[],
  ops: PatchOp[],
): { ops: PatchOp[]; notes: string[] } | null {
  const { concrete } = materializeOps(snapshotLines, ops);
  const remapped: PatchOp[] = [];
  const notes: string[] = [];

  for (const op of concrete) {
    if (op.kind === "rem") {
      remapped.push(op);
      continue;
    }
    if (op.kind === "mv" || op.kind === "swap_blk" || op.kind === "del_blk" || op.kind === "ins_blk_post") {
      continue;
    }
    if (op.kind === "swap" || op.kind === "del") {
      if (op.start < 1 || op.end > snapshotLines.length || op.end < op.start) return null;
      const block = snapshotLines.slice(op.start - 1, op.end);
      const idx = findUniqueBlock(liveLines, block);
      if (idx === null) return null;
      const newStart = idx + 1;
      const newEnd = idx + block.length;
      if (op.kind === "swap") {
        remapped.push({ kind: "swap", start: newStart, end: newEnd, body: op.body });
      } else {
        remapped.push({ kind: "del", start: newStart, end: newEnd });
      }
      if (newStart !== op.start || newEnd !== op.end) {
        notes.push(`Remapped ${op.kind.toUpperCase()} ${op.start}.=${op.end} → ${newStart}.=${newEnd}`);
      }
      continue;
    }
    if (op.kind === "ins") {
      if (op.at === "head" || op.at === "tail") {
        remapped.push(op);
        continue;
      }
      const line = op.line ?? 1;
      if (line < 1 || line > snapshotLines.length) return null;
      const anchor = snapshotLines[line - 1]!;
      const matches = findUniqueLineIndexes(liveLines, anchor);
      let mappedLine: number | null = null;
      if (matches.length === 1) {
        mappedLine = matches[0]! + 1;
      } else {
        const ctxStart = Math.max(0, line - 2);
        const ctxEnd = Math.min(snapshotLines.length, line + 1);
        const ctx = snapshotLines.slice(ctxStart, ctxEnd);
        const idx = findUniqueBlock(liveLines, ctx);
        if (idx === null) return null;
        mappedLine = idx + (line - 1 - ctxStart) + 1;
      }
      remapped.push({ ...op, line: mappedLine });
      if (mappedLine !== line) {
        notes.push(`Remapped INS.${op.at.toUpperCase()} ${line} → ${mappedLine}`);
      }
    }
  }

  notes.unshift(
    "Recovered from stale tag via snapshot content anchors (prior read/edit advanced the file).",
  );
  return { ops: remapped, notes };
}

function formatStaleTagError(
  pathLabel: string,
  sectionTag: string,
  liveTag: string,
  rel: string,
  numbered: string[],
): string {
  const preview = numbered
    .slice(0, 12)
    .map((l, idx) => `${idx + 1}:${l}`)
    .join("\n");
  return (
    `Stale or wrong tag for ${pathLabel}: patch has #${sectionTag}, file is #${liveTag}.\n` +
    `Re-read the file and use the fresh tag.\n` +
    `Current head:\n[${rel}#${liveTag}]\n` +
    `${preview}${numbered.length > 12 ? "\n…" : ""}`
  );
}

/**
 * Apply a full hashline patch language string. Validates file tags against on-disk content.
 * On stale tags, recovers via recorded read/edit snapshots when anchors still match uniquely.
 *
 * Same-path same-tag sections are merged so every op uses the original snapshot.
 * Writes are deferred until every section parses — a later syntax reject must
 * not leave earlier files half-written.
 */
export function applyHashlinePatch(cwd: string, input: string): HashlineResult[] {
  const { sections: rawSections, warnings } = parseHashlinePatch(input);
  const sections = mergeHashlineSections(rawSections);
  const results: HashlineResult[] = [];

  type Pending = {
    sourceAbs: string;
    outAbs: string;
    original: string;
    nextLf: string;
  };
  const pendingByAbs = new Map<string, Pending>();
  const pendingUnlinks = new Set<string>();

  const readLive = (abs: string): { original: string; lf: string; fromDisk: boolean } | null => {
    const pending = pendingByAbs.get(abs);
    if (pending) return { original: pending.original, lf: pending.nextLf, fromDisk: false };
    if (!existsSync(abs)) return null;
    const original = readFileSync(abs, "utf8");
    return { original, lf: normalize(original), fromDisk: true };
  };

  for (const section of sections) {
    const abs = resolvePath(cwd, section.path);
    const isRem = section.ops.some((o) => o.kind === "rem");
    const mvOp = section.ops.find((o): o is Extract<PatchOp, { kind: "mv" }> => o.kind === "mv");

    if (isRem) {
      pendingByAbs.delete(abs);
      pendingUnlinks.add(abs);
      results.push({
        path: abs,
        applied: 1,
        hashes: [],
        summary: `Removed ${displayPath(cwd, abs)}` + (warnings.length ? `\nWarnings: ${warnings.join("; ")}` : ""),
      });
      continue;
    }

    const live = readLive(abs);
    if (!live) {
      throw new Error(
        `File not found: ${section.path}. Hashline edits existing files only — use write to create new files.`,
      );
    }
    const { original, lf, fromDisk } = live;
    const { numbered, hadTrailingNl } = splitNumberedLines(lf);

    const liveTag = computeFileTag(lf);
    if (fromDisk) {
      recordHashlineSnapshot(abs, lf, liveTag);
    }

    const contentOps = section.ops.filter((o) => o.kind !== "mv");
    let concrete: PatchOp[];
    let resolved: string[] = [];
    let recoveryNotes: string[] = [];

    if (section.tag === liveTag) {
      const materialized = materializeOps(numbered, contentOps);
      concrete = materialized.concrete;
      resolved = materialized.resolved;
    } else {
      const onlyHeadTail = contentOps.every(
        (o) => o.kind === "ins" && (o.at === "head" || o.at === "tail"),
      );
      if (onlyHeadTail) {
        const materialized = materializeOps(numbered, contentOps);
        concrete = materialized.concrete;
        resolved = materialized.resolved;
        recoveryNotes = [
          "Applied INS.HEAD/INS.TAIL despite stale tag (position is content-independent).",
        ];
      } else {
        const snapText = getHashlineSnapshot(abs, section.tag);
        if (!snapText) {
          throw new Error(formatStaleTagError(section.path, section.tag, liveTag, displayPath(cwd, abs), numbered));
        }
        const snapLines = splitNumberedLines(normalize(snapText)).numbered;
        const remapped = remapOpsFromSnapshot(snapLines, numbered, contentOps);
        if (!remapped) {
          throw new Error(
            formatStaleTagError(section.path, section.tag, liveTag, displayPath(cwd, abs), numbered) +
              `\nSnapshot for #${section.tag} was found but anchors could not be remapped uniquely — re-read and retry.`,
          );
        }
        concrete = remapped.ops;
        recoveryNotes = remapped.notes;
      }
    }

    const join = (rows: string[]) => joinNumberedLines(rows, hadTrailingNl);
    let nextLines = concrete.length ? applyOpsToLines(numbered, concrete) : numbered;
    let nextLf = join(nextLines);

    const outAbs = mvOp ? resolvePath(cwd, mvOp.dest) : abs;
    const syntax = checkSourceSyntax(outAbs, nextLf, cwd);
    if (!syntax.ok) {
      const repaired = tryExtendShortSwaps({
        lines: numbered,
        ops: concrete,
        resolveBlock: (ls, start) => resolveBlockRange(ls, start),
        applyOps: applyOpsToLines,
        joinLines: join,
        isParsable: (text) => checkSourceSyntax(outAbs, text, cwd).ok,
      });
      if (repaired) {
        concrete = repaired.ops;
        nextLines = applyOpsToLines(numbered, concrete);
        nextLf = join(nextLines);
        recoveryNotes = [...recoveryNotes, ...repaired.notes];
      }
    }

    const syntaxAfter = checkSourceSyntax(outAbs, nextLf, cwd);
    if (!syntaxAfter.ok) {
      throw new Error(formatSyntaxGuardFailure(displayPath(cwd, outAbs), syntaxAfter, nextLf));
    }

    const newTag = computeFileTag(nextLf);
    const rel = displayPath(cwd, outAbs);
    const diff = buildUnifiedDiff(
      rel,
      lf.endsWith("\n") ? lf : `${lf}\n`,
      nextLf.endsWith("\n") ? nextLf : `${nextLf}\n`,
    );
    const largeFileWarning = largeFileEditWarning(rel, nextLf);
    const notes = [
      ...recoveryNotes,
      ...resolved,
      ...(warnings.length ? [`Warnings: ${warnings.join("; ")}`] : []),
      ...(largeFileWarning ? [largeFileWarning] : []),
    ];
    const preview = buildHashlinePreview({
      rel,
      tag: newTag,
      before: lf,
      after: nextLf,
      notes: recoveryNotes,
    });

    pendingUnlinks.delete(outAbs);
    pendingByAbs.set(outAbs, {
      sourceAbs: abs,
      outAbs,
      original: pendingByAbs.get(abs)?.original ?? original,
      nextLf,
    });
    if (mvOp && outAbs !== abs) {
      pendingByAbs.delete(abs);
      pendingUnlinks.add(abs);
    }

    results.push({
      path: outAbs,
      applied: concrete.length + (mvOp ? 1 : 0),
      hashes: [],
      oldTag: section.tag,
      tag: newTag,
      diff,
      patch: diff,
      preview,
      resolved: notes,
      largeFileWarning,
      summary:
        `Edited ${rel} (${concrete.length} op(s)) #${section.tag} → #${newTag}` +
        (mvOp ? ` (moved from ${displayPath(cwd, abs)})` : "") +
        (notes.length ? `\n${notes.join("\n")}` : "") +
        `\n\n${preview}`,
    });
  }

  for (const pending of pendingByAbs.values()) {
    if (pending.outAbs !== pending.sourceAbs) {
      mkdirSync(dirname(pending.outAbs), { recursive: true });
    }
    writeFileSync(pending.outAbs, preserveLineEndings(pending.original, pending.nextLf), "utf8");
    recordHashlineSnapshot(pending.outAbs, pending.nextLf, computeFileTag(pending.nextLf));
  }
  for (const abs of pendingUnlinks) {
    if (pendingByAbs.has(abs)) continue;
    try {
      if (existsSync(abs)) unlinkSync(abs);
    } catch {
      // unlink is best-effort after a successful REM/MV plan
    }
  }

  return results;
}

/** True when args look like a hashline patch `input` string. */
export function isHashlineInputArgs(args: Record<string, unknown>): boolean {
  return typeof args.input === "string" && args.input.trim().length > 0;
}

/** True when args look like classic path+edits. */
export function isClassicEditArgs(args: Record<string, unknown>): boolean {
  if (typeof args.path !== "string" || !args.path.trim()) return false;
  if (Array.isArray(args.edits) && args.edits.length > 0) return true;
  if (typeof args.oldText === "string" && typeof args.newText === "string") return true;
  return false;
}

/** True when args look like hunk-mode hashline. */
export function isHashlineHunkArgs(args: Record<string, unknown>): boolean {
  return typeof args.path === "string" && Array.isArray(args.hunks) && args.hunks.length > 0;
}
