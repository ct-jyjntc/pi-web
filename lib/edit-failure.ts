import { readFileSync, statSync } from "fs";

export type EditFailureKind =
  | "not_found"
  | "not_unique"
  | "overlap"
  | "no_change"
  | "empty_old_text"
  | "io"
  | "aborted"
  | "unknown";

export type EditFailureInfo = {
  kind: EditFailureKind;
  path?: string;
  editIndex?: number;
  occurrences?: number;
  excerpt?: string;
  suggestion: string;
  originalMessage: string;
};

const MAX_EXCERPT_CHARS = 1800;
const EXCERPT_RADIUS = 4;
/** Skip full-file reads above this size (Reviewer P2: unbounded OOM risk). */
const MAX_FILE_BYTES_FOR_EXCERPT = 512 * 1024;

function extractPath(message: string): string | undefined {
  const m =
    message.match(/\bin\s+(\S+?)\.\s/)
    ?? message.match(/Could not edit file:\s*(\S+?)\./)
    ?? message.match(/\bin\s+(\S+)$/);
  return m?.[1];
}

function extractEditIndex(message: string): number | undefined {
  const m = message.match(/edits\[(\d+)\]/);
  return m ? Number(m[1]) : undefined;
}

function extractOccurrences(message: string): number | undefined {
  const m = message.match(/Found\s+(\d+)\s+occurrences/i);
  return m ? Number(m[1]) : undefined;
}

export function classifyEditFailure(error: unknown): EditFailureInfo {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const path = extractPath(originalMessage);
  const editIndex = extractEditIndex(originalMessage);
  const occurrences = extractOccurrences(originalMessage);

  if (/aborted/i.test(originalMessage)) {
    return {
      kind: "aborted",
      path,
      editIndex,
      originalMessage,
      suggestion: "The edit was aborted. Retry if still needed.",
    };
  }
  if (/Could not find the exact text|Could not find edits\[/i.test(originalMessage)) {
    return {
      kind: "not_found",
      path,
      editIndex,
      originalMessage,
      suggestion:
        "Re-read the file, copy a short unique oldText from the current content, and retry. Prefer smaller unique anchors over large blocks.",
    };
  }
  if (/Found\s+\d+\s+occurrences/i.test(originalMessage)) {
    return {
      kind: "not_unique",
      path,
      editIndex,
      occurrences,
      originalMessage,
      suggestion:
        "Include more surrounding context in oldText so it matches exactly one place, or split into separate edits targeting unique anchors.",
    };
  }
  if (/overlap/i.test(originalMessage)) {
    return {
      kind: "overlap",
      path,
      editIndex,
      originalMessage,
      suggestion: "Merge overlapping edits into one edit, or target disjoint regions only.",
    };
  }
  if (/No changes made/i.test(originalMessage)) {
    return {
      kind: "no_change",
      path,
      editIndex,
      originalMessage,
      suggestion: "oldText and newText produced identical content. Confirm the intended replacement and special characters.",
    };
  }
  if (/oldText must not be empty/i.test(originalMessage)) {
    return {
      kind: "empty_old_text",
      path,
      editIndex,
      originalMessage,
      suggestion: "Provide a non-empty oldText that uniquely identifies the target region.",
    };
  }
  if (/Could not edit file|ENOENT|EACCES|EPERM/i.test(originalMessage)) {
    return {
      kind: "io",
      path,
      originalMessage,
      suggestion: "Check that the path exists and is writable, then retry.",
    };
  }
  return {
    kind: "unknown",
    path,
    editIndex,
    originalMessage,
    suggestion: "Re-read the target file and retry with a smaller, unique oldText anchor.",
  };
}

/** Pick a nearby file window around the best-matching line for oldText. */
export function buildEditFailureExcerpt(
  absolutePath: string,
  oldText: string | undefined,
  radiusLines = EXCERPT_RADIUS,
): string | undefined {
  try {
    const st = statSync(absolutePath);
    if (st.size > MAX_FILE_BYTES_FOR_EXCERPT) {
      return `File too large for excerpt (${st.size} bytes > ${MAX_FILE_BYTES_FOR_EXCERPT}). Re-read a smaller range with the read tool.`;
    }
    const raw = readFileSync(absolutePath, "utf8");
    if (!raw) return undefined;
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    if (lines.length === 0) return undefined;

    const needle = (oldText ?? "").replace(/\r\n/g, "\n").trim();
    let center = 0;
    if (needle) {
      const firstNeedleLine = needle.split("\n").find((l) => l.trim())?.trim() ?? "";
      if (firstNeedleLine) {
        let bestScore = -1;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (line.includes(firstNeedleLine)) {
            center = i;
            bestScore = 100;
            break;
          }
          // Cheap similarity: shared prefix length / length
          const a = line.trim();
          const b = firstNeedleLine;
          let shared = 0;
          const n = Math.min(a.length, b.length);
          while (shared < n && a[shared] === b[shared]) shared++;
          const score = n === 0 ? 0 : shared / Math.max(a.length, b.length);
          if (score > bestScore) {
            bestScore = score;
            center = i;
          }
        }
      }
    }

    const start = Math.max(0, center - radiusLines);
    const end = Math.min(lines.length - 1, center + radiusLines);
    const numbered = [];
    for (let i = start; i <= end; i++) {
      numbered.push(`${String(i + 1).padStart(4, " ")}|${lines[i] ?? ""}`);
    }
    let excerpt = numbered.join("\n");
    if (excerpt.length > MAX_EXCERPT_CHARS) {
      excerpt = `${excerpt.slice(0, MAX_EXCERPT_CHARS)}\n… (excerpt truncated)`;
    }
    return excerpt;
  } catch {
    return undefined;
  }
}

export function formatEditFailureMessage(
  info: EditFailureInfo,
  options?: { oldText?: string; absolutePath?: string },
): string {
  const lines = [
    `Edit failed (${info.kind}).`,
    info.originalMessage,
  ];
  if (info.path) lines.push(`path: ${info.path}`);
  if (info.editIndex !== undefined) lines.push(`editIndex: ${info.editIndex}`);
  if (info.occurrences !== undefined) lines.push(`occurrences: ${info.occurrences}`);
  lines.push(`recovery: ${info.suggestion}`);

  const abs = options?.absolutePath;
  if (abs && (info.kind === "not_found" || info.kind === "not_unique" || info.kind === "no_change")) {
    const excerpt = buildEditFailureExcerpt(abs, options?.oldText);
    if (excerpt) {
      lines.push("", "Nearby file excerpt (current on disk):", excerpt);
    }
  }

  lines.push(
    "",
    "Do not rewrite the whole file with write unless the edit is inherently non-local.",
    "Prefer hashline. Copy [path#TAG] and N:line from the last edit response or a fresh read:",
    "  edit({ input: \"[path#TAG]\\nSWAP N.=M:\\n+replacement\" })",
  );
  return lines.join("\n");
}
