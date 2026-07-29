/**
 * Project diagnostics MVP — TypeScript tsc + optional ESLint JSON.
 * Not a full LSP language server; good enough for agent + UI badges.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { join, relative, resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticItem = {
  filePath: string;
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  message: string;
  source: "tsc" | "eslint" | "other";
  code?: string;
};

export type DiagnosticsResult = {
  cwd: string;
  items: DiagnosticItem[];
  sources: string[];
  truncated: boolean;
};

const MAX_ITEMS = 200;

function abs(cwd: string, p: string): string {
  return resolve(cwd, p);
}

function parseTscLine(cwd: string, line: string): DiagnosticItem | null {
  // path(line,col): error TSxxxx: message
  const m = line.match(/^(.*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/);
  if (!m) return null;
  return {
    filePath: abs(cwd, m[1]!),
    line: Number(m[2]),
    column: Number(m[3]),
    severity: m[4] === "warning" ? "warning" : "error",
    code: m[5],
    message: m[6] ?? "",
    source: "tsc",
  };
}

async function runTsc(cwd: string, filePath?: string): Promise<DiagnosticItem[]> {
  const tsconfig = join(cwd, "tsconfig.json");
  if (!existsSync(tsconfig) && !existsSync(join(cwd, "jsconfig.json"))) {
    return [];
  }
  const tscBin = [
    join(cwd, "node_modules", ".bin", "tsc"),
    join(cwd, "node_modules", "typescript", "bin", "tsc"),
  ].find((p) => existsSync(p));

  const cmd = tscBin ?? "npx";
  const args = tscBin
    ? ["--noEmit", "--pretty", "false"]
    : ["--yes", "typescript", "tsc", "--noEmit", "--pretty", "false"];

  try {
    await execFileAsync(cmd, args, {
      cwd,
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return [];
  } catch (error) {
    const err = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    const out = [
      typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "",
      typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "",
    ].join("\n");
    const items: DiagnosticItem[] = [];
    for (const line of out.split("\n")) {
      const item = parseTscLine(cwd, line.trim());
      if (!item) continue;
      if (filePath) {
        const want = resolve(filePath);
        if (resolve(item.filePath) !== want && !item.filePath.endsWith(filePath)) continue;
      }
      items.push(item);
      if (items.length >= MAX_ITEMS) break;
    }
    return items;
  }
}

async function runEslint(cwd: string, filePath?: string): Promise<DiagnosticItem[]> {
  const eslintBin = join(cwd, "node_modules", ".bin", "eslint");
  if (!existsSync(eslintBin)) return [];
  const target = filePath ? relative(cwd, filePath) || filePath : ".";
  try {
    const { stdout } = await execFileAsync(
      eslintBin,
      ["-f", "json", "--max-warnings", "99999", target],
      { cwd, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, env: process.env },
    );
    return parseEslintJson(cwd, stdout);
  } catch (error) {
    const err = error as { stdout?: string | Buffer };
    const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "";
    if (!stdout.trim()) return [];
    try {
      return parseEslintJson(cwd, stdout);
    } catch {
      return [];
    }
  }
}

function parseEslintJson(cwd: string, stdout: string): DiagnosticItem[] {
  const data = JSON.parse(stdout) as Array<{
    filePath: string;
    messages: Array<{
      line?: number;
      column?: number;
      severity?: number;
      message?: string;
      ruleId?: string | null;
    }>;
  }>;
  const items: DiagnosticItem[] = [];
  for (const file of data) {
    for (const msg of file.messages ?? []) {
      items.push({
        filePath: abs(cwd, file.filePath),
        line: msg.line ?? 1,
        column: msg.column ?? 1,
        severity: msg.severity === 2 ? "error" : msg.severity === 1 ? "warning" : "info",
        message: msg.message ?? "",
        code: msg.ruleId ?? undefined,
        source: "eslint",
      });
      if (items.length >= MAX_ITEMS) return items;
    }
  }
  return items;
}

export async function collectDiagnostics(
  cwd: string,
  options?: { filePath?: string },
): Promise<DiagnosticsResult> {
  const [tscItems, eslintItems] = await Promise.all([
    runTsc(cwd, options?.filePath),
    runEslint(cwd, options?.filePath),
  ]);
  const items = [...tscItems, ...eslintItems].slice(0, MAX_ITEMS);
  const sources = [...new Set(items.map((i) => i.source))];
  return {
    cwd,
    items,
    sources,
    truncated: tscItems.length + eslintItems.length > MAX_ITEMS,
  };
}

export function formatDiagnosticsForAgent(result: DiagnosticsResult): string {
  if (result.items.length === 0) {
    return `No diagnostics from ${result.sources.join(", ") || "tsc/eslint"} in ${result.cwd}`;
  }
  const lines = result.items.map((i) => {
    const rel = relative(result.cwd, i.filePath) || i.filePath;
    return `${i.severity.toUpperCase()} ${rel}:${i.line}:${i.column} [${i.source}${i.code ? ` ${i.code}` : ""}] ${i.message}`;
  });
  return [
    `Diagnostics (${result.items.length}${result.truncated ? ", truncated" : ""}) sources=${result.sources.join(",")}`,
    ...lines,
  ].join("\n");
}
