/**
 * Resolve a syntactic/indent block from an opening line. Single owner for
 * SWAP.BLK / DEL.BLK / INS.BLK.POST and the short-SWAP leftover-tail repair.
 */

export type ResolvedBlock = {
  start: number;
  end: number;
  method: "brace" | "indent";
};

/**
 * Resolve a syntactic/indent block starting at 1-based line `startLine`.
 * Prefers brace matching `{[(…)]}`; falls back to indent block (Python-style).
 * Returns inclusive 1-based [start, end]. Throws if the line is not a multi-line opener.
 */
export function resolveBlockRange(lines: string[], startLine: number): ResolvedBlock {
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
    if (i - startIdx > 2000) break;
  }
  return null;
}

function braceDelta(line: string): { open: number; close: number } {
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
  return m[0]!.replace(/\t/g, "    ").length;
}

function resolveIndentBlock(lines: string[], startIdx: number): number | null {
  const open = lines[startIdx] ?? "";
  const looksLikeOpener =
    /:\s*$/.test(open) ||
    /\b(function|class|interface|type|namespace|module|def|fn|func|impl|struct|enum|if|for|while|match|switch)\b/.test(open);
  void looksLikeOpener;
  const base = lineIndent(open);
  let end = startIdx;
  let sawBody = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      end = i;
      continue;
    }
    const ind = lineIndent(line);
    if (ind > base) {
      sawBody = true;
      end = i;
      continue;
    }
    break;
  }
  if (!sawBody) return null;
  while (end > startIdx && (lines[end] ?? "").trim() === "") end--;
  return end > startIdx ? end : null;
}
