/**
 * Single owner for post-edit parse checks on JS/TS sources.
 * Cheap syntax only (not full tsc typecheck). Hashline/edit call this
 * before treating a write as success so "applied" never means "unparsable".
 */
import { createRequire } from "module";
import { extname, join } from "path";

const GUARDED_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

export type SyntaxIssue = {
  line: number;
  column: number;
  message: string;
};

export type SyntaxCheckResult =
  | { ok: true }
  | { ok: false; errors: SyntaxIssue[] };

type TypescriptModule = {
  createSourceFile: (
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes: boolean,
    scriptKind?: number,
  ) => {
    parseDiagnostics?: Array<{
      start?: number;
      messageText: string | { messageText: string };
    }>;
    getLineAndCharacterOfPosition: (pos: number) => { line: number; character: number };
  };
  ScriptTarget: { Latest: number };
  ScriptKind: {
    TS: number;
    TSX: number;
    JS: number;
    JSX: number;
  };
  flattenDiagnosticMessageText: (message: unknown, newLine: string) => string;
};

const tsCache = new Map<string, TypescriptModule | null>();

function loadTypescript(cwd: string): TypescriptModule | null {
  const key = cwd || process.cwd();
  if (tsCache.has(key)) return tsCache.get(key) ?? null;

  const bases = [key, process.cwd()].filter(Boolean);
  for (const base of bases) {
    try {
      const requireFrom = createRequire(join(base, "package.json"));
      const ts = requireFrom("typescript") as TypescriptModule;
      tsCache.set(key, ts);
      return ts;
    } catch {
      // try next
    }
    try {
      const requireFrom = createRequire(join(base, "node_modules", "typescript", "package.json"));
      const ts = requireFrom(".") as TypescriptModule;
      tsCache.set(key, ts);
      return ts;
    } catch {
      // try next
    }
  }

  tsCache.set(key, null);
  return null;
}

export function isSyntaxGuardedPath(filePath: string): boolean {
  return GUARDED_EXTS.has(extname(filePath).toLowerCase());
}

function scriptKindFor(ts: TypescriptModule, filePath: string): number {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Strip strings/comments roughly so a brace balancer is not fooled by `{` in strings.
 * Not a full lexer — only used when typescript is unavailable.
 */
function stripNoise(content: string): string {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const c = content[i]!;
    const n = content[i + 1];
    if (c === "/" && n === "/") {
      i += 2;
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      const q = c;
      out += " ";
      i++;
      while (i < content.length) {
        if (content[i] === "\\") {
          i += 2;
          continue;
        }
        if (content[i] === q) {
          i++;
          break;
        }
        if (q === "`" && content[i] === "$" && content[i + 1] === "{") {
          // template expression — keep braces for balance by emitting placeholder
          out += " ";
          i += 2;
          let depth = 1;
          while (i < content.length && depth > 0) {
            if (content[i] === "{") depth++;
            else if (content[i] === "}") depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function checkBracketBalance(content: string): SyntaxCheckResult {
  const cleaned = stripNoise(content);
  const stack: Array<{ ch: string; line: number; column: number }> = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let line = 1;
  let column = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "\n") {
      line++;
      column = 0;
      continue;
    }
    column++;
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push({ ch, line, column });
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      const want = pairs[ch]!;
      const top = stack.pop();
      if (!top || top.ch !== want) {
        return {
          ok: false,
          errors: [{
            line,
            column,
            message: top
              ? `Unmatched '${ch}' (opened '${top.ch}' at ${top.line}:${top.column})`
              : `Unmatched '${ch}'`,
          }],
        };
      }
    }
  }
  if (stack.length) {
    const top = stack[stack.length - 1]!;
    return {
      ok: false,
      errors: [{
        line: top.line,
        column: top.column,
        message: `Unclosed '${top.ch}'`,
      }],
    };
  }
  return { ok: true };
}

function checkWithTypescript(
  ts: TypescriptModule,
  filePath: string,
  content: string,
): SyntaxCheckResult {
  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    scriptKindFor(ts, filePath),
  );
  const diags = source.parseDiagnostics ?? [];
  if (!diags.length) return { ok: true };
  const errors: SyntaxIssue[] = diags.slice(0, 8).map((d) => {
    const pos = typeof d.start === "number" ? d.start : 0;
    const { line, character } = source.getLineAndCharacterOfPosition(pos);
    return {
      line: line + 1,
      column: character + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    };
  });
  return { ok: false, errors };
}

/**
 * @param filePath absolute or relative path (extension decides language)
 * @param content full file text after the proposed edit
 * @param cwd project root used to resolve local `typescript`
 */
export function checkSourceSyntax(
  filePath: string,
  content: string,
  cwd: string = process.cwd(),
): SyntaxCheckResult {
  if (!isSyntaxGuardedPath(filePath)) return { ok: true };
  const ts = loadTypescript(cwd);
  if (ts) return checkWithTypescript(ts, filePath, content);
  return checkBracketBalance(content);
}

export function formatSyntaxGuardFailure(
  displayPath: string,
  result: Extract<SyntaxCheckResult, { ok: false }>,
): string {
  const lines = result.errors
    .map((e) => `  ${e.line}:${e.column}  ${e.message}`)
    .join("\n");
  return (
    `Edit rejected: would leave unparsable source in ${displayPath}.\n` +
    `The file was not modified.\n` +
    `Parse errors:\n${lines}\n` +
    `Re-read the file, shrink the patch (one hunk / one concern), ensure SWAP/INS body lines start with '+', and retry.`
  );
}
