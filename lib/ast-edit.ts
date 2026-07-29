/**
 * Minimal AST-aware edits for TypeScript/JavaScript via the TS compiler API.
 * Supports: rename identifier in-file, replace call expression name, simple string literal update.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import ts from "typescript";

export type AstEditOp =
  | {
    kind: "rename_identifier";
    /** 1-based line of an occurrence of the identifier */
    line: number;
    character: number;
    newName: string;
  }
  | {
    kind: "replace_text_in_node";
    line: number;
    character: number;
    newText: string;
  };

export type AstEditResult = {
  path: string;
  changes: number;
  description: string;
};

function offsetAt(sf: ts.SourceFile, line: number, character: number): number {
  return sf.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, character - 1));
}

function findNodeAt(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let match: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (pos >= node.getStart(sf) && pos < node.getEnd()) {
      match = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sf);
  return match;
}

export function applyAstEdit(
  cwd: string,
  pathValue: string,
  op: AstEditOp,
): AstEditResult {
  const abs = resolve(cwd, pathValue);
  const original = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pos = offsetAt(sf, op.line, op.character);
  const node = findNodeAt(sf, pos);
  if (!node) throw new Error("No AST node at position");

  if (op.kind === "rename_identifier") {
    if (!ts.isIdentifier(node)) {
      throw new Error(`Expected identifier, got ${ts.SyntaxKind[node.kind]}`);
    }
    const oldName = node.text;
    const newName = op.newName;
    if (!newName || newName === oldName) throw new Error("newName must differ from current identifier");

    // Collect all identifiers with same name in this file (local rename).
    const ranges: Array<{ start: number; end: number }> = [];
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === oldName) {
        ranges.push({ start: n.getStart(sf), end: n.getEnd() });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    ranges.sort((a, b) => b.start - a.start);
    let text = original;
    for (const r of ranges) {
      text = text.slice(0, r.start) + newName + text.slice(r.end);
    }
    writeFileSync(abs, text, "utf8");
    return {
      path: abs,
      changes: ranges.length,
      description: `Renamed identifier '${oldName}' → '${newName}' (${ranges.length} occurrence(s) in-file)`,
    };
  }

  // replace_text_in_node: replace the exact node text span
  const start = node.getStart(sf);
  const end = node.getEnd();
  const text = original.slice(0, start) + op.newText + original.slice(end);
  writeFileSync(abs, text, "utf8");
  return {
    path: abs,
    changes: 1,
    description: `Replaced ${ts.SyntaxKind[node.kind]} node at ${op.line}:${op.character}`,
  };
}
