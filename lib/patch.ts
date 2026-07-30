export type SplitDiffCellType = "context" | "removed" | "added" | "empty";

export interface SplitDiffCell {
  lineNo: number | null;
  text: string;
  type: SplitDiffCellType;
}

export type SplitDiffRow =
  | { type: "hunk"; text: string }
  | { type: "line"; left: SplitDiffCell; right: SplitDiffCell };

export interface SplitDiffFile {
  oldPath?: string;
  newPath?: string;
  rows: SplitDiffRow[];
  /** Set on the last returned file when `maxRows` dropped trailing rows. */
  truncated?: boolean;
  /** Number of `line` rows dropped because of `maxRows` (0 when untruncated). */
  hiddenRows?: number;
}

export interface ParseUnifiedPatchOptions {
  /** Cap on emitted `line` rows across all files. Omit for no limit. */
  maxRows?: number;
}

/** Default row budget for inline diff rendering — keeps the DOM bounded. */
export const MAX_DIFF_ROWS = 400;

interface PendingChangeLine {
  lineNo: number;
  text: string;
}

export function parseUnifiedPatch(text: string, options?: ParseUnifiedPatchOptions): SplitDiffFile[] | null {
  const maxRows = options?.maxRows ?? Number.POSITIVE_INFINITY;
  let emittedRows = 0;
  let hiddenRows = 0;
  const files: SplitDiffFile[] = [];
  let current: SplitDiffFile | null = null;
  let pendingOldPath: string | undefined;
  let oldLineNo = 0;
  let newLineNo = 0;
  let removed: PendingChangeLine[] = [];
  let added: PendingChangeLine[] = [];

  const emptyCell = (): SplitDiffCell => ({ lineNo: null, text: "", type: "empty" });
  const flushChanges = () => {
    if (!current) {
      removed = [];
      added = [];
      return;
    }
    const count = Math.max(removed.length, added.length);
    for (let i = 0; i < count; i++) {
      if (emittedRows >= maxRows) {
        hiddenRows += count - i;
        break;
      }
      const left = removed[i]
        ? { lineNo: removed[i].lineNo, text: removed[i].text, type: "removed" as const }
        : emptyCell();
      const right = added[i]
        ? { lineNo: added[i].lineNo, text: added[i].text, type: "added" as const }
        : emptyCell();
      current.rows.push({ type: "line", left, right });
      emittedRows++;
    }
    removed = [];
    added = [];
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("--- ")) {
      flushChanges();
      pendingOldPath = cleanPatchPath(line.slice(4));
      continue;
    }

    if (line.startsWith("+++ ")) {
      flushChanges();
      current = { oldPath: pendingOldPath, newPath: cleanPatchPath(line.slice(4)), rows: [] };
      files.push(current);
      continue;
    }

    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      if (!current) {
        current = { rows: [] };
        files.push(current);
      }
      flushChanges();
      oldLineNo = Number(hunk[1]);
      newLineNo = Number(hunk[2]);
      // Meta rows are dropped once the budget is spent — they carry no content.
      if (hiddenRows === 0) current.rows.push({ type: "hunk", text: line });
      continue;
    }

    if (!current) continue;

    if (line.startsWith("\\ ")) {
      flushChanges();
      if (hiddenRows === 0) current.rows.push({ type: "hunk", text: line });
      continue;
    }

    const prefix = line[0];
    const content = line.slice(1);

    if (prefix === " ") {
      flushChanges();
      if (emittedRows >= maxRows) {
        hiddenRows++;
        oldLineNo++;
        newLineNo++;
      } else {
        current.rows.push({
          type: "line",
          left: { lineNo: oldLineNo++, text: content, type: "context" },
          right: { lineNo: newLineNo++, text: content, type: "context" },
        });
        emittedRows++;
      }
    } else if (prefix === "-") {
      removed.push({ lineNo: oldLineNo++, text: content });
    } else if (prefix === "+") {
      added.push({ lineNo: newLineNo++, text: content });
    } else if (line !== "") {
      flushChanges();
      if (hiddenRows === 0) current.rows.push({ type: "hunk", text: line });
    }
  }

  flushChanges();

  const parsed = files.filter((file) => file.rows.some((row) => row.type === "line"));
  if (parsed.length === 0) return null;
  if (hiddenRows > 0) {
    const last = parsed[parsed.length - 1];
    last.truncated = true;
    last.hiddenRows = hiddenRows;
  }
  return parsed;
}

function cleanPatchPath(path: string): string {
  return path.split("\t")[0].trim();
}
