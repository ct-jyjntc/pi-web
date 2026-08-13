/**
 * Hashline patch-language parser. Single owner for SWAP/DEL/INS plus PUT/CUT
 * aliases (current oh-my-pi verbs map onto the same IR). Apply lives in
 * hashline-edit.ts — this module does not touch the filesystem.
 */
export type PatchOp =
  | { kind: "swap"; start: number; end: number; body: string[] }
  | { kind: "del"; start: number; end: number }
  | { kind: "ins"; at: "pre" | "post" | "head" | "tail"; line?: number; body: string[] }
  | { kind: "swap_blk"; line: number; body: string[] }
  | { kind: "del_blk"; line: number }
  | { kind: "ins_blk_post"; line: number; body: string[] }
  | { kind: "rem" }
  | { kind: "mv"; dest: string };

export type PatchSection = {
  path: string;
  tag: string;
  ops: PatchOp[];
};

const SECTION_RE = /^\[(.+?)#([0-9A-Fa-f]{4})\]\s*$/;
// Inclusive range separators: .= .. : - – — or whitespace. Trailing : on the op is separate.
const RANGE_SEP = "(?:\\.?=|\\.{2}|:|-|–|—|\\s+)";
// SWAP 3: / SWAP 3.=5: / SWAP 3:5: / SWAP.BLK 3:
const SWAP_RE = new RegExp(
  `^SWAP(?:\\.BLK\\s+(\\d+)(?:${RANGE_SEP}(\\d+))?|\\s+(\\d+)(?:${RANGE_SEP}(\\d+))?)\\s*:?\\s*$`,
  "i",
);
const DEL_RE = new RegExp(
  `^DEL(?:\\.BLK\\s+(\\d+)(?:${RANGE_SEP}(\\d+))?|\\s+(\\d+)(?:${RANGE_SEP}(\\d+))?)\\s*:?\\s*$`,
  "i",
);
const INS_RE = /^INS\.(PRE|POST|HEAD|TAIL|BLK\.POST)(?:\s+(\d+))?\s*:?\s*$/i;
const REM_RE = /^REM\s*$/i;
const MV_RE = /^MV\s+(.+?)\s*$/i;
const PUT_RE = new RegExp(
  `^PUT(?:\\s+(<|>)?(\\d+|\\$)(\\*)?(?:${RANGE_SEP}(\\d+))?)?\\s*:?\\s*$`,
  "i",
);
const CUT_RE = new RegExp(
  `^CUT(?:\\s+(\\d+)(\\*)?(?:${RANGE_SEP}(\\d+))?)?\\s*:?\\s*$`,
  "i",
);
const BARE_RANGE_RE = new RegExp(`^(\\d+)(?:${RANGE_SEP}(\\d+))?\\s*:\\s*$`);

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function isHashlineOpLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (trimmed.startsWith("[")) return true;
  if (/^(SWAP|DEL|INS\.|PUT\b|CUT\b|REM\b|MV\s)/i.test(trimmed)) return true;
  return BARE_RANGE_RE.test(trimmed);
}

/**
 * Parse inclusive 1-based range. Models often write `N.=K` meaning "start + count"
 * (K lines) instead of end line; when end < start, reinterpret as count.
 */
export function parseRange(
  a: string,
  b: string | undefined,
  warnings?: string[],
): { start: number; end: number } {
  const start = Number(a);
  let end = b !== undefined && b !== "" ? Number(b) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
    throw new Error(`Invalid line range: ${a}${b ? `.=${b}` : ""}`);
  }
  if (end < start) {
    // Count-style: SWAP 349.=6 → lines 349..354 (6 lines). Always safer than fail.
    const count = end;
    end = start + count - 1;
    warnings?.push(
      `Interpreted ${start}.=${count} as count → lines ${start}.=${end} ` +
        `(N.=M is inclusive end line, not line count; prefer SWAP ${start}.=${end}:)`,
    );
  }
  return { start, end };
}

function parseBodyRow(line: string): string | null {
  if (line.startsWith("+")) return line.slice(1);
  if (line.trim() === "") return "";
  return line;
}

/** Drop unified-diff `-old` rows when the body also has `+new` (omp). Keep `+- item`. */
function finalizeBody(raw: string[]): string[] {
  const hasPlus = raw.some((l) => l.startsWith("+"));
  const kept = hasPlus
    ? raw.filter((l) => !l.startsWith("-") || l.startsWith("+-"))
    : raw;
  const body: string[] = [];
  for (const line of kept) {
    const row = parseBodyRow(line);
    if (row !== null) body.push(row);
  }
  return body;
}

function collectBody(lines: string[], startAt: number): { body: string[]; next: number } {
  const raw: string[] = [];
  let i = startAt;
  while (i < lines.length) {
    const bl = lines[i]!;
    const trimmed = bl.trim();
    if (isHashlineOpLine(trimmed) && !bl.startsWith("+") && !bl.startsWith("-")) break;
    if (
      bl.startsWith("+")
      || bl.startsWith("-")
      || (trimmed !== "" && !SECTION_RE.test(trimmed) && !isHashlineOpLine(trimmed))
    ) {
      raw.push(bl);
      i++;
      continue;
    }
    if (trimmed === "") {
      const next = lines[i + 1]?.trim() ?? "";
      if (isHashlineOpLine(next) || next === "") break;
    }
    break;
  }
  return { body: finalizeBody(raw), next: i };
}

function putToOp(
  loc: string,
  star: boolean,
  endRaw: string | undefined,
  side: "<" | ">" | undefined,
  body: string[],
  warnings: string[],
): PatchOp {
  if (loc === "$") {
    if (side !== ">") {
      throw new Error("PUT $ is only valid as PUT >$: (insert at end of file).");
    }
    return { kind: "ins", at: "tail", body };
  }
  const line = Number(loc);
  if (!Number.isFinite(line) || line < 1) {
    throw new Error(`PUT requires a 1-based line number, got: ${loc}`);
  }
  if (star) {
    if (side === ">") return { kind: "ins_blk_post", line, body };
    if (side === "<") {
      throw new Error("PUT <N*: is not valid. Use PUT <N: to insert before line N, or PUT N*: to replace the block.");
    }
    return { kind: "swap_blk", line, body };
  }
  if (side === "<") {
    if (line === 1) return { kind: "ins", at: "head", body };
    return { kind: "ins", at: "pre", line, body };
  }
  if (side === ">") {
    return { kind: "ins", at: "post", line, body };
  }
  const { start, end } = parseRange(loc, endRaw, warnings);
  return { kind: "swap", start, end, body };
}

/**
 * Collapse repeated `[path#TAG]` sections so every op still sees the original
 * snapshot line numbers. Sequential apply of two same-tag sections would shift
 * the second section's anchors.
 */
export function mergeHashlineSections(sections: PatchSection[]): PatchSection[] {
  const out: PatchSection[] = [];
  const index = new Map<string, number>();
  for (const section of sections) {
    const key = `${section.path}\0${section.tag}`;
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, out.length);
      out.push({ path: section.path, tag: section.tag, ops: [...section.ops] });
    } else {
      out[existing]!.ops.push(...section.ops);
    }
  }
  return out;
}

/**
 * Parse one or more `[path#TAG]` sections from an `input` string.
 * Supports SWAP/DEL/INS/REM/MV, SWAP.BLK/DEL.BLK/INS.BLK.POST, and PUT/CUT aliases.
 */
export function parseHashlinePatch(input: string): { sections: PatchSection[]; warnings: string[] } {
  const text = normalize(input).replace(/\*\*\* Begin Patch\s*/g, "").replace(/\*\*\* End Patch\s*/g, "");
  const lines = text.split("\n");
  const sections: PatchSection[] = [];
  const warnings: string[] = [];
  let i = 0;

  while (i < lines.length && lines[i]!.trim() === "") i++;

  while (i < lines.length) {
    const header = lines[i]!.trim();
    if (!header) {
      i++;
      continue;
    }
    const hm = header.match(SECTION_RE);
    if (!hm) {
      const placeholder = header.match(/^\[(.+?)#([A-Za-z0-9_-]{1,8})\]\s*$/);
      if (placeholder && !/^[0-9A-Fa-f]{4}$/.test(placeholder[2]!)) {
        throw new Error(
          `Placeholder or invalid tag #${placeholder[2]} is not a real 4-hex fingerprint for ${placeholder[1]}.\n` +
            `Re-read the file and copy the [path#TAG] header from the read output (e.g. #A1B2).\n` +
            `Never invent tags or use #XXXX / #TAG placeholders.`,
        );
      }
      throw new Error(
        `Expected section header [path#TAG] (4-hex tag), got: ${header.slice(0, 80)}\n` +
          `Example:\n[src/foo.ts#A1B2]\nSWAP 10.=10:\n+const x = 1\n` +
          `TAG must be the real 4-hex fingerprint from a fresh read — not #XXXX or #TAG.`,
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
        const isBlk = Boolean(swap[1]);
        const collected = collectBody(lines, i + 1);
        i = collected.next;
        if (isBlk) {
          section.ops.push({ kind: "swap_blk", line: Number(swap[1]), body: collected.body });
        } else {
          const { start, end } = parseRange(swap[3]!, swap[4], warnings);
          section.ops.push({ kind: "swap", start, end, body: collected.body });
        }
        continue;
      }

      const put = trimmed.match(PUT_RE);
      if (put && (put[2] || put[1])) {
        const collected = collectBody(lines, i + 1);
        i = collected.next;
        const side = put[1] === "<" || put[1] === ">" ? put[1] : undefined;
        section.ops.push(putToOp(put[2]!, Boolean(put[3]), put[4], side, collected.body, warnings));
        continue;
      }

      const bare = trimmed.match(BARE_RANGE_RE);
      if (bare && !/^(SWAP|DEL|INS\.|PUT\b|CUT\b)/i.test(trimmed)) {
        const collected = collectBody(lines, i + 1);
        i = collected.next;
        const { start, end } = parseRange(bare[1]!, bare[2], warnings);
        section.ops.push({ kind: "swap", start, end, body: collected.body });
        warnings.push(`Bare ${trimmed} treated as SWAP (prefer SWAP ${start}.=${end}: or PUT ${start}.=${end}:).`);
        continue;
      }

      const del = trimmed.match(DEL_RE);
      if (del) {
        const isBlk = Boolean(del[1]);
        if (isBlk) {
          section.ops.push({ kind: "del_blk", line: Number(del[1]) });
        } else {
          const { start, end } = parseRange(del[3]!, del[4], warnings);
          section.ops.push({ kind: "del", start, end });
        }
        i++;
        continue;
      }

      const cut = trimmed.match(CUT_RE);
      if (cut && cut[1]) {
        if (cut[2]) {
          section.ops.push({ kind: "del_blk", line: Number(cut[1]) });
        } else {
          const { start, end } = parseRange(cut[1], cut[3], warnings);
          section.ops.push({ kind: "del", start, end });
        }
        i++;
        continue;
      }

      const ins = trimmed.match(INS_RE);
      if (ins) {
        const posRaw = ins[1]!.toUpperCase();
        const lineNum = ins[2] ? Number(ins[2]) : undefined;
        const collected = collectBody(lines, i + 1);
        i = collected.next;
        if (posRaw === "BLK.POST") {
          if (!lineNum || lineNum < 1) throw new Error("INS.BLK.POST requires a 1-based line number");
          section.ops.push({ kind: "ins_blk_post", line: lineNum, body: collected.body });
        } else {
          let at: "pre" | "post" | "head" | "tail";
          if (posRaw === "PRE") at = "pre";
          else if (posRaw === "POST") at = "post";
          else if (posRaw === "HEAD") at = "head";
          else at = "tail";
          if ((at === "pre" || at === "post") && (!lineNum || lineNum < 1)) {
            throw new Error(`INS.${posRaw} requires a 1-based line number`);
          }
          section.ops.push({ kind: "ins", at, line: lineNum, body: collected.body });
        }
        continue;
      }

      if (
        !trimmed.startsWith("+")
        && !isHashlineOpLine(trimmed)
        && /[{}();=]|^\s*(const|let|var|function|import|export|return|if|class|type|interface)\b/.test(trimmed)
      ) {
        throw new Error(
          `Hashline body lines must start with '+'. Got: ${trimmed.slice(0, 100)}\n` +
            `Example:\n  SWAP 10.=10:\n  +const x = 1;\n` +
            `Re-read the file and resend the patch with '+' on every body row.`,
        );
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
