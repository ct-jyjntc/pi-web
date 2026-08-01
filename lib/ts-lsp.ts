/**
 * Lightweight TypeScript LanguageService helpers for references + rename.
 * Not a full LSP server — works for TS/JS projects with a local tsconfig.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import ts from "typescript";

export type LspLocation = {
  filePath: string;
  line: number; // 1-based
  character: number; // 1-based
  lineText?: string;
};

export type RenameEdit = {
  filePath: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  newText: string;
};

function findTsConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 24; i++) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function walkSourceFiles(root: string, out: string[], depth = 0): void {
  if (depth > 12 || out.length > 4000) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".next" || name === "out") continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkSourceFiles(full, out, depth + 1);
    else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
}

type ServiceBundle = {
  service: ts.LanguageService;
  program: ts.Program | undefined;
  configFile: string | null;
  projectRoot: string;
  dispose: () => void;
};

function createService(cwd: string, focusFile?: string): ServiceBundle {
  const configFile = findTsConfig(focusFile ? dirname(focusFile) : cwd) ?? findTsConfig(cwd);
  const projectRoot = configFile ? dirname(configFile) : cwd;
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: false,
  };

  let rootNames: string[] = [];
  let options = compilerOptions;

  if (configFile) {
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configFile));
    options = { ...parsed.options, skipLibCheck: true };
    rootNames = parsed.fileNames;
  } else {
    walkSourceFiles(projectRoot, rootNames);
  }

  if (focusFile && !rootNames.includes(resolve(focusFile))) {
    rootNames = [...rootNames, resolve(focusFile)];
  }

  const versions = new Map<string, string>();
  const snapshots = new Map<string, ts.IScriptSnapshot>();

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => rootNames,
    getScriptVersion: (fileName) => versions.get(fileName) ?? "1",
    getScriptSnapshot: (fileName) => {
      const cached = snapshots.get(fileName);
      if (cached) return cached;
      if (!existsSync(fileName)) return undefined;
      const text = readFileSync(fileName, "utf8");
      const snap = ts.ScriptSnapshot.fromString(text);
      snapshots.set(fileName, snap);
      return snap;
    },
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return {
    service,
    program: service.getProgram(),
    configFile,
    projectRoot,
    dispose: () => service.dispose(),
  };
}

function posToLocation(filePath: string, pos: number, sourceFile: ts.SourceFile): LspLocation {
  const lc = sourceFile.getLineAndCharacterOfPosition(pos);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(lc.line, 0);
  const lineTextRaw = sourceFile.text.slice(lineStart).split("\n", 1)[0]?.replace(/\r$/, "") ?? "";
  return {
    filePath,
    line: lc.line + 1,
    character: lc.character + 1,
    lineText: lineTextRaw.trim(),
  };
}

function offsetAt(sourceFile: ts.SourceFile, line: number, character: number): number {
  const l = Math.max(0, line - 1);
  const c = Math.max(0, character - 1);
  try {
    return sourceFile.getPositionOfLineAndCharacter(l, c);
  } catch {
    // clamp to file end
    return Math.min(sourceFile.text.length, sourceFile.getPositionOfLineAndCharacter(l, 0) + c);
  }
}

export function findReferences(
  cwd: string,
  filePath: string,
  line: number,
  character: number,
): { symbolName?: string; locations: LspLocation[]; configFile: string | null } {
  const abs = resolve(filePath);
  const bundle = createService(cwd, abs);
  try {
    const sf = bundle.service.getProgram()?.getSourceFile(abs);
    if (!sf) throw new Error(`File not in TypeScript project: ${filePath}`);
    const pos = offsetAt(sf, line, character);
    const defs = bundle.service.getDefinitionAtPosition(abs, pos);
    const symbolName = defs?.[0]?.name;
    const refs = bundle.service.findReferences(abs, pos) ?? [];
    const locations: LspLocation[] = [];
    for (const group of refs) {
      for (const ref of group.references) {
        const file = bundle.service.getProgram()?.getSourceFile(ref.fileName);
        if (!file) continue;
        locations.push(posToLocation(ref.fileName, ref.textSpan.start, file));
      }
    }
    return { symbolName, locations, configFile: bundle.configFile };
  } finally {
    bundle.dispose();
  }
}

export function planRename(
  cwd: string,
  filePath: string,
  line: number,
  character: number,
  newName: string,
): { symbolName?: string; edits: RenameEdit[]; configFile: string | null } {
  if (!newName.trim()) throw new Error("newName is required");
  const abs = resolve(filePath);
  const bundle = createService(cwd, abs);
  try {
    const sf = bundle.service.getProgram()?.getSourceFile(abs);
    if (!sf) throw new Error(`File not in TypeScript project: ${filePath}`);
    const pos = offsetAt(sf, line, character);
    const renameInfo = bundle.service.getRenameInfo(abs, pos, { allowRenameOfImportPath: false });
    if (!renameInfo.canRename) {
      throw new Error(renameInfo.localizedErrorMessage || "Cannot rename symbol at position");
    }
    const locs = bundle.service.findRenameLocations(abs, pos, false, false, {
      providePrefixAndSuffixTextForRename: false,
    }) ?? [];
    const edits: RenameEdit[] = [];
    for (const loc of locs) {
      const file = bundle.service.getProgram()?.getSourceFile(loc.fileName);
      if (!file) continue;
      const start = file.getLineAndCharacterOfPosition(loc.textSpan.start);
      const end = file.getLineAndCharacterOfPosition(loc.textSpan.start + loc.textSpan.length);
      edits.push({
        filePath: loc.fileName,
        startLine: start.line + 1,
        startCharacter: start.character + 1,
        endLine: end.line + 1,
        endCharacter: end.character + 1,
        newText: newName,
      });
    }
    return {
      symbolName: renameInfo.displayName,
      edits,
      configFile: bundle.configFile,
    };
  } finally {
    bundle.dispose();
  }
}

/** Apply rename edits (files processed independently, reverse order within file). */
export function applyRenameEdits(edits: RenameEdit[]): { filesChanged: string[]; count: number } {
  const byFile = new Map<string, RenameEdit[]>();
  for (const e of edits) {
    const list = byFile.get(e.filePath) ?? [];
    list.push(e);
    byFile.set(e.filePath, list);
  }
  let count = 0;
  const filesChanged: string[] = [];
  for (const [filePath, fileEdits] of byFile) {
    const original = readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true);
    // sort by position descending
    const sorted = [...fileEdits].sort((a, b) => {
      const ap = sf.getPositionOfLineAndCharacter(a.startLine - 1, a.startCharacter - 1);
      const bp = sf.getPositionOfLineAndCharacter(b.startLine - 1, b.startCharacter - 1);
      return bp - ap;
    });
    let text = original;
    for (const e of sorted) {
      const start = sf.getPositionOfLineAndCharacter(e.startLine - 1, e.startCharacter - 1);
      const end = sf.getPositionOfLineAndCharacter(e.endLine - 1, e.endCharacter - 1);
      text = text.slice(0, start) + e.newText + text.slice(end);
      count += 1;
    }
    if (text !== original) {
      writeFileSync(filePath, text, "utf8");
      filesChanged.push(filePath);
    }
  }
  return { filesChanged, count };
}

export function formatLocations(cwd: string, locations: LspLocation[]): string {
  if (locations.length === 0) return "No references found.";
  return locations
    .map((loc, i) => {
      const rel = relative(cwd, loc.filePath) || loc.filePath;
      return `${i + 1}. ${rel}:${loc.line}:${loc.character}${loc.lineText ? `  ${loc.lineText}` : ""}`;
    })
    .join("\n");
}
