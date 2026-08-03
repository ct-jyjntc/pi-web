/**
 * Single owner for "format this file with the project's formatter".
 * Detects prettier / biome from package.json + config files, runs the local
 * binary with stdin content, and returns the formatted text. Never throws on
 * formatter failure — formatting is best-effort and must not block saves.
 */
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const FORMAT_TIMEOUT_MS = 15_000;
const MAX_FORMAT_BYTES = 512 * 1024;

export type FormatterKind = "prettier" | "biome";

export type DetectedFormatter = {
  kind: FormatterKind;
  bin: string;
};

const PRETTIER_CONFIG_NAMES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.mjs",
  ".prettierrc.cjs",
  "prettier.config.js",
  "prettier.config.mjs",
  "prettier.config.cjs",
];

const BIOME_CONFIG_NAMES = ["biome.json", "biome.jsonc"];

function findUp(dir: string, fileName: string): string | null {
  let current = dir;
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function packageHasDependency(cwd: string, name: string): boolean {
  const pkgPath = findUp(cwd, "package.json");
  if (!pkgPath) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

function localBin(cwd: string, binName: string): string | null {
  const pkgRoot = findUp(cwd, "package.json");
  if (pkgRoot) {
    const candidate = join(resolve(pkgRoot, ".."), "node_modules", ".bin", binName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Detect whether `cwd` (or a parent) has a formatter configured for the file.
 * Resolution order: project package.json dependency, then config file presence.
 */
export function detectFormatter(cwd: string): DetectedFormatter | null {
  if (packageHasDependency(cwd, "prettier") || PRETTIER_CONFIG_NAMES.some((n) => findUp(cwd, n))) {
    const bin = localBin(cwd, "prettier");
    if (bin) return { kind: "prettier", bin };
  }
  if (packageHasDependency(cwd, "@biomejs/biome") || BIOME_CONFIG_NAMES.some((n) => findUp(cwd, n))) {
    const bin = localBin(cwd, "biome");
    if (bin) return { kind: "biome", bin };
  }
  return null;
}

function runFormatter(bin: string, args: string[], content: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    if (Buffer.byteLength(content, "utf8") > MAX_FORMAT_BYTES) {
      resolvePromise(null);
      return;
    }
    const child = spawn(bin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolvePromise(null);
    }, FORMAT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      // ignore noisy formatter logs
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(null);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && stdout) resolvePromise(stdout);
      else if (code === 0) resolvePromise(content);
      else resolvePromise(null);
    });
    child.stdin.end(content, "utf8");
  });
}

/**
 * Format `content` for `filePath` using the project formatter.
 * Returns the formatted text, or null when no formatter is configured,
 * unavailable, or the run failed/timeout. Never throws.
 */
export async function formatFileWithProjectFormatter(
  cwd: string,
  filePath: string,
  content: string,
): Promise<string | null> {
  const formatter = detectFormatter(cwd);
  if (!formatter) return null;
  try {
    if (formatter.kind === "prettier") {
      return await runFormatter(formatter.bin, ["--stdin-filepath", filePath], content);
    }
    // biome: newer CLI uses --stdin-file-path; older used --stdin-filepath.
    const modern = await runFormatter(formatter.bin, ["format", "--stdin-file-path", filePath], content);
    if (modern != null) return modern;
    return await runFormatter(formatter.bin, ["format", "--stdin-filepath", filePath], content);
  } catch {
    return null;
  }
}

/**
 * Format a file on disk in place when the project has a formatter.
 * Best-effort: returns true when the file was rewritten, false otherwise.
 * Used by the agent edit tool so agent edits land formatted (opencode parity).
 */
export async function formatFileOnDisk(cwd: string, filePath: string): Promise<boolean> {
  const formatter = detectFormatter(cwd);
  if (!formatter) return false;
  try {
    const content = readFileSync(filePath, "utf8");
    const formatted = await formatFileWithProjectFormatter(cwd, filePath, content);
    if (formatted != null && formatted !== content) {
      writeFileSync(filePath, formatted, "utf8");
      return true;
    }
  } catch {
    // Formatting must never break an agent edit.
  }
  return false;
}
