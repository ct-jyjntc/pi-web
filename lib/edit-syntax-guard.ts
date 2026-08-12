/**
 * Single owner for post-edit parse checks on JS/TS sources.
 * Cheap syntax only (not full tsc typecheck). Hashline/edit call this
 * before treating a write as success so "applied" never means "unparsable".
 *
 * Invariant: only hard-reject when a real parser (typescript) confirms the
 * source is unparsable. Heuristic bracket balancing is not a second recovery
 * path — it false-positives on regex character classes and nested templates
 * (e.g. `/^[}\\])]/` and `` `${start}.=${end}:)` ``) and blocked valid edits.
 */
import { existsSync } from "fs";
import { createRequire } from "module";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";

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

/** Process-wide cache: one successful load is enough for the whole agent runtime. */
let cachedTypescript: TypescriptModule | null | undefined;

function tryLoadFromPackageRoot(root: string): TypescriptModule | null {
  const pkgJson = join(root, "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    const requireFrom = createRequire(pkgJson);
    const ts = requireFrom(".") as TypescriptModule;
    if (ts && typeof ts.createSourceFile === "function") return ts;
  } catch {
    // try named export path
  }
  try {
    const requireFrom = createRequire(pkgJson);
    const ts = requireFrom("typescript") as TypescriptModule;
    if (ts && typeof ts.createSourceFile === "function") return ts;
  } catch {
    // not here
  }
  return null;
}

/**
 * Resolve the typescript package once. Prefer the app-installed copy (from this
 * module / cwd) so Next/Electron agent processes do not depend on the session
 * cwd having its own node_modules/typescript.
 */
export function loadTypescript(): TypescriptModule | null {
  if (cachedTypescript !== undefined) return cachedTypescript;

  // 1) Same resolution graph as this file (pi-web's dependency).
  try {
    const requireFromHere = createRequire(import.meta.url);
    const ts = requireFromHere("typescript") as TypescriptModule;
    if (ts && typeof ts.createSourceFile === "function") {
      cachedTypescript = ts;
      return ts;
    }
  } catch {
    // walk filesystem next
  }

  // 2) Walk up from this module looking for node_modules/typescript.
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
      const loaded = tryLoadFromPackageRoot(join(dir, "node_modules", "typescript"));
      if (loaded) {
        cachedTypescript = loaded;
        return loaded;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // import.meta.url may be unavailable in some bundles — fall through
  }

  // 3) process.cwd() project install.
  const fromCwd = tryLoadFromPackageRoot(join(process.cwd(), "node_modules", "typescript"));
  if (fromCwd) {
    cachedTypescript = fromCwd;
    return fromCwd;
  }
  try {
    const requireFromCwd = createRequire(join(process.cwd(), "package.json"));
    const ts = requireFromCwd("typescript") as TypescriptModule;
    if (ts && typeof ts.createSourceFile === "function") {
      cachedTypescript = ts;
      return ts;
    }
  } catch {
    // give up
  }

  cachedTypescript = null;
  return null;
}

/** Test helper — drop the process-wide typescript cache. */
export function clearTypescriptCache(): void {
  cachedTypescript = undefined;
}

/**
 * Test helper — force the cached loader result (including `null` fail-open).
 * Production code must not call this.
 */
export function setTypescriptForTests(ts: TypescriptModule | null | undefined): void {
  cachedTypescript = ts;
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
 * @param _cwd kept for call-site compatibility; typescript is resolved from the app install
 */
export function checkSourceSyntax(
  filePath: string,
  content: string,
  _cwd: string = process.cwd(),
): SyntaxCheckResult {
  if (!isSyntaxGuardedPath(filePath)) return { ok: true };
  const ts = loadTypescript();
  if (!ts) {
    // Fail open: without a real parser we must not block edits. The old
    // bracket-balance fallback false-rejected valid files (regex classes,
    // nested template literals) and is intentionally not used as a hard gate.
    return { ok: true };
  }
  return checkWithTypescript(ts, filePath, content);
}

export function formatSyntaxGuardFailure(
  displayPath: string,
  result: Extract<SyntaxCheckResult, { ok: false }>,
  source?: string,
): string {
  const lines = result.errors
    .map((e) => `  ${e.line}:${e.column}  ${e.message}`)
    .join("\n");
  let excerpt = "";
  if (source) {
    const first = result.errors[0];
    const all = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const numbered =
      all.length > 0 && all[all.length - 1] === "" ? all.slice(0, -1) : all;
    const center = first?.line ?? 1;
    const from = Math.max(1, center - 3);
    const to = Math.min(numbered.length, center + 4);
    const body = numbered
      .slice(from - 1, to)
      .map((l, i) => `  ${from + i}|${l}`)
      .join("\n");
    excerpt =
      `\nWould-be source around first error (file not written):\n${body}\n`;
  }
  return (
    `Edit rejected: would leave unparsable source in ${displayPath}.\n` +
    `The file was not modified.\n` +
    `Parse errors:\n${lines}\n` +
    excerpt +
    `Re-read the file. Leftover tail usually means SWAP N.=M ended before the construct closer — use SWAP.BLK N: or widen M.\n` +
    `Opener and closer of a wrap must be in the SAME patch. Shrink to one hunk / one concern, ensure body lines start with '+', and retry.`
  );
}
