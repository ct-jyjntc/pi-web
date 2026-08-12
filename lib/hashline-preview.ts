/**
 * Compact post-edit numbered preview. Single owner for the re-ground surface
 * the model copies into the next edit({ input }) — [path#TAG] plus N:line rows
 * around the changed span, using post-edit line numbers.
 */

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Minimal unified diff for chat SplitPatchView (single hunk, 3 lines of context). */
export function buildUnifiedDiff(path: string, before: string, after: string): string {
  const a = normalize(before).replace(/\n$/, "").split("\n");
  const b = normalize(after).replace(/\n$/, "").split("\n");
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
  const linesOut: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${hStart + 1},${Math.max(oldCount, 0)} +${hStart + 1},${Math.max(newCount, 0)} @@`,
  ];
  for (let i = hStart; i < start; i++) linesOut.push(` ${a[i] ?? ""}`);
  for (let i = start; i <= aEnd; i++) {
    if (i >= 0 && i < a.length) linesOut.push(`-${a[i]}`);
  }
  for (let i = start; i <= bEnd; i++) {
    if (i >= 0 && i < b.length) linesOut.push(`+${b[i]}`);
  }
  const afterStartA = aEnd + 1;
  const ctxLines = Math.min(context, a.length - afterStartA, b.length - (bEnd + 1));
  for (let k = 0; k < ctxLines; k++) {
    linesOut.push(` ${a[afterStartA + k] ?? ""}`);
  }
  return linesOut.join("\n") + "\n";
}

function previewLines(text: string): string[] {
  const lf = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!lf) return [];
  const parts = lf.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") return parts.slice(0, -1);
  return parts;
}

export type HashlinePreviewOptions = {
  rel: string;
  tag: string;
  before: string;
  after: string;
  notes?: string[];
  /** Max numbered rows to show (default 48). Long spans elide the middle. */
  maxLines?: number;
  /** Unchanged context lines on each side of the changed span (default 2). */
  context?: number;
};

/**
 * Build `[rel#TAG]` + optional notes + `N:text` rows of the NEW file around
 * the first/last changed line. Line numbers are post-edit so the next SWAP
 * can copy them without a full re-read.
 */
export function buildHashlinePreview(opts: HashlinePreviewOptions): string {
  const before = previewLines(opts.before);
  const after = previewLines(opts.after);
  const rows: string[] = [`[${opts.rel}#${opts.tag}]`];
  if (opts.notes?.length) {
    for (const note of opts.notes) {
      if (note) rows.push(note);
    }
  }

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let aEnd = before.length - 1;
  let bEnd = after.length - 1;
  while (aEnd >= start && bEnd >= start && before[aEnd] === after[bEnd]) {
    aEnd--;
    bEnd--;
  }

  if (after.length === 0) {
    rows.push("(file empty after edit)");
    return rows.join("\n");
  }
  if (start > aEnd && start > bEnd) {
    rows.push("(no content change)");
    return rows.join("\n");
  }

  const ctx = opts.context ?? 2;
  const showStart = Math.max(0, start - ctx);
  const showEnd = Math.min(after.length - 1, Math.max(bEnd, start) + ctx);
  const max = opts.maxLines ?? 48;
  const span = showEnd - showStart + 1;

  const pushRow = (i: number) => {
    rows.push(`${i + 1}:${after[i] ?? ""}`);
  };

  if (span <= max) {
    for (let i = showStart; i <= showEnd; i++) pushRow(i);
  } else {
    const head = Math.ceil(max / 2);
    const tail = max - head;
    for (let i = showStart; i < showStart + head; i++) pushRow(i);
    rows.push("…");
    for (let i = showEnd - tail + 1; i <= showEnd; i++) pushRow(i);
  }
  return rows.join("\n");
}
