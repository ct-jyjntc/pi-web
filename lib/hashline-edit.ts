/**
 * Hashline-style edits: anchor replacements by content hash of oldText lines.
 * Safer against whitespace drift than pure string match when using normalize mode.
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

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
};

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function hashBlock(text: string): string {
  return createHash("sha1").update(normalize(text)).digest("hex").slice(0, 12);
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
  const abs = resolve(cwd, pathValue);
  const original = readFileSync(abs, "utf8");
  let content = normalize(original);
  const hashes: string[] = [];

  // Apply from bottom to top if we track indices — first compute all matches on original snapshot.
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

  // Preserve original line endings if file was CRLF-only
  const out = original.includes("\r\n") && !original.includes("\n\n\r")
    ? next.replace(/\n/g, "\r\n")
    : next;
  writeFileSync(abs, out, "utf8");
  return { path: abs, applied: planned.length, hashes };
}
