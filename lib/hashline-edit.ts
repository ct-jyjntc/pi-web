/**
 * Hashline edit engine for Pi Web.
 *
 * Two surfaces:
 * 1) **Patch language** (omp-compatible subset) — preferred default for `edit`:
 *    ```
 *    [path/to/file.ts#A1B2]
 *    SWAP 10.=12:
 *    +const x = 1
 *    DEL 20
 *    INS.POST 30:
 *    +// note
 *    ```
 *    TAG is a 4-hex fingerprint of the whole normalized file (must match on-disk).
 *
 * 2) **Hunk mode** — `{ path, hunks: [{ hash?, oldText, newText }] }` with optional
 *    per-block sha1[:12] guards (legacy `hashline_edit` tool).
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";

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
  /** Alias of diff for MessageView.getResultDiff. */
  patch?: string;
  /** Human notes e.g. SWAP.BLK 1 → lines 1-4 */
  resolved?: string[];
};

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
  let content = normalize(original);
  const hashes: string[] = [];

  type Planned = { start: number; end: number; newText: string; hash: string };
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
    planned.push({ start: first, end: first + oldText.length, newText, hash: h });
    hashes.push(h);
  }

  planned.sort((a, b) => b.start - a.start);
  let next = content;
  for (const p of planned) {
    next = next.slice(0, p.start) + p.newText + next.slice(p.end);
  }

  writeFileSync(abs, preserveLineEndings(original, next), "utf8");
  const rel = displayPath(cwd, abs);
  const newTag = computeFileTag(next);
  const oldTag = computeFileTag(content);
  const before = content.endsWith("\n") ? content : `${content}\n`;
  const after = next.endsWith("\n") ? next : `${next}\n`;
  const diff = buildUnifiedDiff(rel, before, after);
  return {
    path: abs,
    applied: planned.length,
    hashes,
    oldTag,
    tag: newTag,
    diff,
    patch: diff,
    summary: `Applied ${planned.length} hashline hunk(s) to ${rel} → #${newTag}`,
  };
}

// ─── Patch language (omp-compatible subset) ─────────────────────────────────

type PatchOp =
  | { kind: "swap"; start: number; end: number; body: string[] }
  | { kind: "del"; start: number; end: number }
  | { kind: "ins"; at: "pre" | "post" | "head" | "tail"; line?: number; body: string[] }
  | { kind: "swap_blk"; line: number; body: string[] }
  | { kind: "del_blk"; line: number }
  | { kind: "ins_blk_post"; line: number; body: string[] }
  | { kind: "rem" }
  | { kind: "mv"; dest: string };

type PatchSection = {
  path: string;
  tag: string;
  ops: PatchOp[];
};

const SECTION_RE = /^\[(.+?)#([0-9A-Fa-f]{4})\]\s*$/;
// SWAP 3: / SWAP 3.=5: / SWAP.BLK 3: / SWAP.BLK 3.=8: (range on BLK is tolerated; resolve still from start)
const SWAP_RE = /^SWAP(?:\.BLK\s+(\d+)(?:(?:\.?=|\.\.|-|–|—|\s+)(\d+))?|\s+(\d+)(?:(?:\.?=|\.\.|-|–|—|\s+)(\d+))?)\s*:?\s*$/i;
// DEL 3 / DEL 3.=5 / DEL.BLK 3 / DEL.BLK 3.=8
const DEL_RE = /^DEL(?:\.BLK\s+(\d+)(?:(?:\.?=|\.\.|-|–|—|\s+)(\d+))?|\s+(\d+)(?:(?:\.?=|\.\.|-|–|—|\s+)(\d+))?)\s*$/i;
const INS_RE = /^INS\.(PRE|POST|HEAD|TAIL|BLK\.POST)(?:\s+(\d+))?\s*:?\s*$/i;
const REM_RE = /^REM\s*$/i;
const MV_RE = /^MV\s+(.+?)\s*$/i;

function parseRange(a: string, b: string | undefined): { start: number; end: number } {
  const start = Number(a);
  const end = b !== undefined && b !== "" ? Number(b) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
    throw new Error(`Invalid line range: ${a}${b ? `.=${b}` : ""}`);
  }
  if (end < start) throw new Error(`Invalid line range ${start}.=${end}: end < start`);
  return { start, end };
}

function parseBodyRow(line: string): string | null {
  if (line.startsWith("+")) return line.slice(1);
  // bare body row (omp auto-pipes)
  if (line.trim() === "") return "";
  return line;
}

/**
 * Resolve a syntactic/indent block starting at 1-based line `startLine`.
 * Prefers brace matching `{[(…)]}`; falls back to indent block (Python-style).
 * Returns inclusive 1-based [start, end]. Throws if the line is not a multi-line opener.
 */
export function resolveBlockRange(lines: string[], startLine: number): { start: number; end: number; method: "brace" | "indent" } {
  if (startLine < 1 || startLine > lines.length) {
    throw new Error(`Block anchor line ${startLine} out of bounds (file has ${lines.length} lines).`);
  }
  const idx = startLine - 1;
  const openLine = lines[idx] ?? "";
  if (!openLine.trim()) {
    throw new Error(`Block anchor line ${startLine} is blank. Point SWAP.BLK/DEL.BLK at the opening line of a construct.`);
  }
  if (/^[}\])]+\s*;?\s*$/.test(openLine.trim())) {
    throw new Error(
      `Block anchor line ${startLine} looks like a closer. Point at the opening line, or use plain SWAP/DEL/INS.POST.`,
    );
  }

  const braceEnd = resolveBraceBlock(lines, idx);
  if (braceEnd !== null && braceEnd > idx) {
    return { start: startLine, end: braceEnd + 1, method: "brace" };
  }

  const indentEnd = resolveIndentBlock(lines, idx);
  if (indentEnd !== null && indentEnd > idx) {
    return { start: startLine, end: indentEnd + 1, method: "indent" };
  }

  throw new Error(
    `Could not resolve a multi-line block at line ${startLine}. ` +
      `Use plain SWAP ${startLine}.=${startLine}: / DEL ${startLine} / INS.POST ${startLine}: instead.`,
  );
}

function resolveBraceBlock(lines: string[], startIdx: number): number | null {
  let depth = 0;
  let seenOpen = false;
  for (let i = startIdx; i < lines.length; i++) {
    const delta = braceDelta(lines[i] ?? "");
    if (delta.open > 0) seenOpen = true;
    depth += delta.open - delta.close;
    if (seenOpen && depth === 0) return i;
    // Cap runaway
    if (i - startIdx > 2000) break;
  }
  return null;
}

function braceDelta(line: string): { open: number; close: number } {
  // Strip // comments and rough strings so braces in them don't count.
  let s = line.replace(/\/\/.*$/, "");
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  s = s.replace(/`(?:\\.|[^`\\])*`/g, "``");
  let open = 0;
  let close = 0;
  for (const ch of s) {
    if (ch === "{" || ch === "(" || ch === "[") open++;
    else if (ch === "}" || ch === ")" || ch === "]") close++;
  }
  return { open, close };
}

function lineIndent(line: string): number {
  const m = line.match(/^[ \t]*/);
  if (!m) return 0;
  // tabs count as 4 for comparison stability
  return m[0]!.replace(/\t/g, "    ").length;
}

function resolveIndentBlock(lines: string[], startIdx: number): number | null {
  const open = lines[startIdx] ?? "";
  // Require classic block openers or a trailing ':' (Python) / '{' already handled by brace
  const looksLikeOpener =
    /:\s*$/.test(open) ||
    /\b(function|class|interface|type|namespace|module|def|fn|func|impl|struct|enum|if|for|while|match|switch)\b/.test(open);
  if (!looksLikeOpener && !/\{\s*$/.test(open)) {
    // still try indent children if next line is deeper
  }
  const base = lineIndent(open);
  let end = startIdx;
  let sawBody = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      end = i; // include trailing blank inside block tentatively
      continue;
    }
    const ind = lineIndent(line);
    if (ind > base) {
      sawBody = true;
      end = i;
      continue;
    }
    // same or less indent ends the block; don't include this line
    break;
  }
  if (!sawBody) return null;
  // trim trailing blanks from end
  while (end > startIdx && (lines[end] ?? "").trim() === "") end--;
  return end > startIdx ? end : null;
}

/** Build a minimal unified diff for UI rendering. */
export function buildUnifiedDiff(path: string, before: string, after: string): string {
  const a = normalize(before).replace(/\n$/, "").split("\n");
  const b = normalize(after).replace(/\n$/, "").split("\n");
  // Find first/last changed indices
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length - 1;
  let bEnd = b.length - 1;
  while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
    aEnd--;
    bEnd--;
  }
  const context = 3;
  const hStart = Math.max(0, start - context);
  const aHEnd = Math.min(a.length - 1, aEnd + context);
  const bHEnd = Math.min(b.length - 1, bEnd + context);

  const oldCount = a.length === 0 ? 0 : aHEnd - hStart + 1;
  const newCount = b.length === 0 ? 0 : bHEnd - hStart + 1;
  // Approximate hunk header (single hunk)
  const linesOut: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${hStart + 1},${Math.max(oldCount, 0)} +${hStart + 1},${Math.max(newCount, 0)} @@`,
  ];
  // context before
  for (let i = hStart; i < start; i++) linesOut.push(` ${a[i] ?? ""}`);
  // deletions
  for (let i = start; i <= aEnd; i++) {
    if (i >= 0 && i < a.length) linesOut.push(`-${a[i]}`);
  }
  // additions
  for (let i = start; i <= bEnd; i++) {
    if (i >= 0 && i < b.length) linesOut.push(`+${b[i]}`);
  }
  // context after — from matching tails
  const afterStartA = aEnd + 1;
  const afterStartB = bEnd + 1;
  const ctxLines = Math.min(context, a.length - afterStartA, b.length - afterStartB);
  for (let k = 0; k < ctxLines; k++) {
    linesOut.push(` ${a[afterStartA + k] ?? ""}`);
  }
  return linesOut.join("\n") + "\n";
}

/**
 * Parse one or more `[path#TAG]` sections from an `input` string.
 * Supports SWAP/DEL/INS/REM/MV and SWAP.BLK/DEL.BLK/INS.BLK.POST (resolved at apply time).
 */
export function parseHashlinePatch(input: string): { sections: PatchSection[]; warnings: string[] } {
  const text = normalize(input).replace(/\*\*\* Begin Patch\s*/g, "").replace(/\*\*\* End Patch\s*/g, "");
  const lines = text.split("\n");
  const sections: PatchSection[] = [];
  const warnings: string[] = [];
  let i = 0;

  // Skip leading empty lines
  while (i < lines.length && lines[i]!.trim() === "") i++;

  while (i < lines.length) {
    const header = lines[i]!.trim();
    if (!header) {
      i++;
      continue;
    }
    const hm = header.match(SECTION_RE);
    if (!hm) {
      throw new Error(
        `Expected section header [path#TAG] (4-hex tag), got: ${header.slice(0, 80)}\n` +
          `Example:\n[src/foo.ts#A1B2]\nSWAP 10.=10:\n+const x = 1`,
      );
    }
    const section: PatchSection = {
      path: hm[1]!.trim(),
      tag: hm[2]!.toUpperCase(),
      ops: [],
    };
    i++;

    while (i < lines.length) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (!trimmed) {
        i++;
        continue;
      }
      if (SECTION_RE.test(trimmed)) break;

      if (REM_RE.test(trimmed)) {
        section.ops.push({ kind: "rem" });
        i++;
        continue;
      }
      const mv = trimmed.match(MV_RE);
      if (mv) {
        section.ops.push({ kind: "mv", dest: mv[1]!.replace(/^["']|["']$/g, "").trim() });
        i++;
        continue;
      }

      const swap = trimmed.match(SWAP_RE);
      if (swap) {
        // groups: 1=BLK start, 2=BLK end?, 3=plain start, 4=plain end?
        const isBlk = Boolean(swap[1]);
        i++;
        const body: string[] = [];
        while (i < lines.length) {
          const bl = lines[i]!;
          if (/^(SWAP|DEL|INS\.|REM\b|MV\s|\[)/i.test(bl.trim()) && !bl.startsWith("+")) break;
          if (bl.startsWith("+") || (!SECTION_RE.test(bl.trim()) && bl.trim() !== "" && !/^(SWAP|DEL|INS\.|REM\b|MV\s)/i.test(bl.trim()))) {
            const row = parseBodyRow(bl);
            if (row !== null) body.push(row);
            i++;
            continue;
          }
          if (bl.trim() === "") {
            const next = lines[i + 1]?.trim() ?? "";
            if (/^(SWAP|DEL|INS\.|REM\b|MV\s|\[)/i.test(next) || next === "") break;
          }
          break;
        }
        if (isBlk) {
          // Prefer structural resolve from opening line; optional end is ignored (model often guesses).
          section.ops.push({ kind: "swap_blk", line: Number(swap[1]), body });
        } else {
          const { start, end } = parseRange(swap[3]!, swap[4]);
          section.ops.push({ kind: "swap", start, end, body });
        }
        continue;
      }

      const del = trimmed.match(DEL_RE);
      if (del) {
        // groups: 1=BLK start, 2=BLK end?, 3=plain start, 4=plain end?
        const isBlk = Boolean(del[1]);
        if (isBlk) {
          section.ops.push({ kind: "del_blk", line: Number(del[1]) });
        } else {
          const { start, end } = parseRange(del[3]!, del[4]);
          section.ops.push({ kind: "del", start, end });
        }
        i++;
        continue;
      }

      const ins = trimmed.match(INS_RE);
      if (ins) {
        const posRaw = ins[1]!.toUpperCase();
        const lineNum = ins[2] ? Number(ins[2]) : undefined;
        i++;
        const body: string[] = [];
        while (i < lines.length) {
          const bl = lines[i]!;
          if (/^(SWAP|DEL|INS\.|REM\b|MV\s|\[)/i.test(bl.trim()) && !bl.startsWith("+")) break;
          if (bl.startsWith("+") || (bl.trim() !== "" && !SECTION_RE.test(bl.trim()) && !/^(SWAP|DEL|INS\.|REM\b|MV\s)/i.test(bl.trim()))) {
            const row = parseBodyRow(bl);
            if (row !== null) body.push(row);
            i++;
            continue;
          }
          break;
        }
        if (posRaw === "BLK.POST") {
          if (!lineNum || lineNum < 1) throw new Error("INS.BLK.POST requires a 1-based line number");
          section.ops.push({ kind: "ins_blk_post", line: lineNum, body });
        } else {
          let at: "pre" | "post" | "head" | "tail";
          if (posRaw === "PRE") at = "pre";
          else if (posRaw === "POST") at = "post";
          else if (posRaw === "HEAD") at = "head";
          else at = "tail";
          if ((at === "pre" || at === "post") && (!lineNum || lineNum < 1)) {
            throw new Error(`INS.${posRaw} requires a 1-based line number`);
          }
          section.ops.push({ kind: "ins", at, line: lineNum, body });
        }
        continue;
      }

      throw new Error(`Unrecognized hashline op: ${trimmed.slice(0, 100)}`);
    }

    if (section.ops.length === 0) {
      throw new Error(`Section [${section.path}#${section.tag}] has no ops`);
    }
    sections.push(section);
  }

  if (sections.length === 0) {
    throw new Error(
      "Empty hashline patch. Expected at least one [path#TAG] section.\n" +
        "Get TAG from a fresh read of the file (or compute via current content fingerprint).",
    );
  }
  return { sections, warnings };
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

/**
 * Apply a full hashline patch language string. Validates file tags against on-disk content.
 */
export function applyHashlinePatch(cwd: string, input: string): HashlineResult[] {
  const { sections, warnings } = parseHashlinePatch(input);
  const results: HashlineResult[] = [];

  for (const section of sections) {
    const abs = resolvePath(cwd, section.path);
    const isRem = section.ops.some((o) => o.kind === "rem");
    const mvOp = section.ops.find((o): o is Extract<PatchOp, { kind: "mv" }> => o.kind === "mv");

    if (!existsSync(abs) && !isRem) {
      throw new Error(
        `File not found: ${section.path}. Hashline edits existing files only — use write to create new files.`,
      );
    }

    if (isRem) {
      if (existsSync(abs)) unlinkSync(abs);
      results.push({
        path: abs,
        applied: 1,
        hashes: [],
        summary: `Removed ${displayPath(cwd, abs)}` + (warnings.length ? `\nWarnings: ${warnings.join("; ")}` : ""),
      });
      continue;
    }

    const original = readFileSync(abs, "utf8");
    const lf = normalize(original);
    // Keep trailing empty line behavior: split like most editors
    const lines = lf.length === 0 ? [] : lf.split("\n");
    // If file ends with newline, last split element is ""; keep it as a blank line only if
    // there was content — actually split("a\n") => ["a", ""] which is wrong for line counts.
    // Use: lines without final empty from trailing newline for numbering, re-add on write.
    const hadTrailingNl = lf.endsWith("\n");
    const numbered = hadTrailingNl && lines.length > 0 && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;

    const liveTag = computeFileTag(lf);
    if (section.tag !== liveTag) {
      const preview = numbered
        .slice(0, 12)
        .map((l, idx) => `${idx + 1}:${l}`)
        .join("\n");
      throw new Error(
        `Stale or wrong tag for ${section.path}: patch has #${section.tag}, file is #${liveTag}.\n` +
          `Re-read the file and use the fresh tag.\n` +
          `Current head:\n[${displayPath(cwd, abs)}#${liveTag}]\n${preview}${numbered.length > 12 ? "\n…" : ""}`,
      );
    }

    const contentOps = section.ops.filter((o) => o.kind !== "mv");
    const { concrete, resolved } = materializeOps(numbered, contentOps);
    const nextLines = concrete.length ? applyOpsToLines(numbered, concrete) : numbered;
    let nextLf = nextLines.join("\n");
    if (hadTrailingNl || nextLines.length > 0) {
      // Prefer trailing newline for text files
      if (!nextLf.endsWith("\n") && nextLines.length > 0) nextLf += "\n";
    }

    const outAbs = mvOp ? resolvePath(cwd, mvOp.dest) : abs;
    if (mvOp) {
      mkdirSync(dirname(outAbs), { recursive: true });
    }
    writeFileSync(outAbs, preserveLineEndings(original, nextLf), "utf8");
    if (mvOp && outAbs !== abs) {
      try {
        unlinkSync(abs);
      } catch {
        // if write was in-place rename via write+unlink
      }
    }

    const newTag = computeFileTag(nextLf);
    const rel = displayPath(cwd, outAbs);
    const diff = buildUnifiedDiff(rel, lf.endsWith("\n") ? lf : `${lf}\n`, nextLf.endsWith("\n") ? nextLf : `${nextLf}\n`);
    const notes = [
      ...resolved,
      ...(warnings.length ? [`Warnings: ${warnings.join("; ")}`] : []),
    ];
    results.push({
      path: outAbs,
      applied: concrete.length + (mvOp ? 1 : 0),
      hashes: [],
      oldTag: section.tag,
      tag: newTag,
      diff,
      patch: diff,
      resolved: notes,
      summary:
        `Edited ${rel} (${concrete.length} op(s)) #${section.tag} → #${newTag}` +
        (mvOp ? ` (moved from ${displayPath(cwd, abs)})` : "") +
        (resolved.length ? `\n${resolved.join("\n")}` : "") +
        (warnings.length ? `\nWarnings: ${warnings.join("; ")}` : ""),
    });
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

/**
 * Format a read-style header + line dump for prompts/errors so the model can
 * copy TAG and line numbers into a patch.
 */
export function formatHashlineReadout(cwd: string, pathValue: string, maxLines = 200): string {
  const abs = resolvePath(cwd, pathValue);
  const original = readFileSync(abs, "utf8");
  const lf = normalize(original);
  const tag = computeFileTag(lf);
  const hadTrailingNl = lf.endsWith("\n");
  const lines = lf.length === 0 ? [] : lf.split("\n");
  const numbered = hadTrailingNl && lines.length > 0 && lines[lines.length - 1] === ""
    ? lines.slice(0, -1)
    : lines;
  const slice = numbered.slice(0, maxLines);
  const body = slice.map((l, i) => `${i + 1}:${l}`).join("\n");
  const more = numbered.length > maxLines ? `\n… (${numbered.length - maxLines} more lines)` : "";
  return `[${displayPath(cwd, abs)}#${tag}]\n${body}${more}`;
}
