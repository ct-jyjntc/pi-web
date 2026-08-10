#!/usr/bin/env node
/**
 * Pre-bundle heavy first-party pi extensions so runtime can load them as
 * extensionFactories (plain ESM) instead of jiti-transpiling their TypeScript
 * sources on every cold start.
 *
 * Output: <package>/.pi-web-bundle/extension.mjs
 * (inside the package so nested deps like strip-json-comments still resolve)
 *
 * Prefer the esbuild JS API (cross-platform). Fall back to CLI via
 * node_modules/.bin / npx when the package is not installed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { applySubagentsStaleCtxPatch } from "./apply-subagents-stale-ctx-patch.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** @type {Array<{ name: string; packageName: string; entry: string; aliasSrc?: string }>} */
const TARGETS = [
  {
    name: "permission",
    packageName: "@gotgenes/pi-permission-system",
    entry: "src/index.ts",
    aliasSrc: "src",
  },
  {
    name: "subagents",
    packageName: "@gotgenes/pi-subagents",
    entry: "src/index.ts",
    aliasSrc: "src",
  },
  {
    name: "mcp-adapter",
    packageName: "pi-mcp-adapter",
    entry: "index.ts",
  },
];

function resolvePackageRoot(packageName) {
  const parts = packageName.split("/");
  const candidates = [join(root, "node_modules", ...parts)];
  try {
    for (const base of require.resolve.paths(packageName) ?? []) {
      candidates.push(join(base, ...parts));
    }
  } catch {
    // ignore
  }
  for (const dir of candidates) {
    const pkgJson = join(dir, "package.json");
    if (!existsSync(pkgJson)) continue;
    try {
      const name = JSON.parse(readFileSync(pkgJson, "utf8")).name;
      if (name === packageName) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Build one extension with the esbuild JS API when available.
 * @returns {{ status: number, stderr: string, stdout: string }}
 */
function runEsbuildApi(options) {
  let esbuild;
  try {
    esbuild = require("esbuild");
  } catch (err) {
    // Package missing → fall through to CLI. Anything else is a hard failure later.
    const message = err instanceof Error ? err.message : String(err);
    return { status: -1, stderr: message, stdout: "" };
  }
  try {
    esbuild.buildSync(options);
    return { status: 0, stderr: "", stdout: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 1, stderr: message, stdout: "" };
  }
}

/**
 * CLI fallback: prefer npm bin shims (esbuild.cmd on Windows), never
 * `node esbuild/bin/esbuild` (postinstall replaces that with a native binary
 * on Unix; on Windows the unscoped path is not a runnable .exe).
 * @param {string[]} args
 */
function runEsbuildCli(args) {
  const localName = process.platform === "win32" ? "esbuild.cmd" : "esbuild";
  const local = join(root, "node_modules", ".bin", localName);
  if (existsSync(local)) {
    return spawnSync(local, args, {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  }

  // Fall back to npx (needs shell on Windows so .cmd resolves).
  return spawnSync("npx", ["--yes", "esbuild@0.25.12", ...args], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function bundleOne(target) {
  // The subagents bundle embeds the stale-ctx emit guard — sources must be
  // patched before esbuild reads them (see apply-subagents-stale-ctx-patch.mjs).
  if (target.name === "subagents") applySubagentsStaleCtxPatch();

   const pkgRoot = resolvePackageRoot(target.packageName);
  if (!pkgRoot) {
    return { ok: false, name: target.name, error: `package not installed: ${target.packageName}` };
  }
  const entryAbs = join(pkgRoot, target.entry);
  if (!existsSync(entryAbs)) {
    return { ok: false, name: target.name, error: `entry missing: ${entryAbs}` };
  }

  const outDir = join(pkgRoot, ".pi-web-bundle");
  const outFile = join(outDir, "extension.mjs");
  mkdirSync(outDir, { recursive: true });

  /** @type {Record<string, string>} */
  const alias = {
    // Extensions historically resolve pi-ai root to the compat entry (jiti virtualModules).
    "@earendil-works/pi-ai": "@earendil-works/pi-ai/compat",
    "@mariozechner/pi-ai": "@earendil-works/pi-ai/compat",
  };
  if (target.aliasSrc) {
    alias["#src"] = join(pkgRoot, target.aliasSrc);
  }

  // 1) JS API — works on macOS / Linux / Windows without bin path quirks.
  let result = runEsbuildApi({
    entryPoints: [entryAbs],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    alias,
    outfile: outFile,
    logLevel: "silent",
  });

  // 2) CLI only if the esbuild package itself is missing.
  if (result.status === -1) {
    /** @type {string[]} */
    const args = [
      entryAbs,
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--packages=external",
      "--alias:@earendil-works/pi-ai=@earendil-works/pi-ai/compat",
      "--alias:@mariozechner/pi-ai=@earendil-works/pi-ai/compat",
      `--outfile=${outFile}`,
    ];
    if (target.aliasSrc) {
      args.push(`--alias:#src=${join(pkgRoot, target.aliasSrc)}`);
    }
    result = runEsbuildCli(args);
  }

  if (result.status !== 0) {
    return {
      ok: false,
      name: target.name,
      error: (result.stderr || result.stdout || "esbuild failed").trim(),
    };
  }
  if (!existsSync(outFile)) {
    return { ok: false, name: target.name, error: "esbuild produced no output" };
  }

  // Stamp for debugging / cache invalidation.
  writeFileSync(
    join(outDir, "meta.json"),
    `${JSON.stringify(
      {
        name: target.name,
        packageName: target.packageName,
        entry: target.entry,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { ok: true, name: target.name, outFile, bytes: readFileSync(outFile).byteLength };
}

export function bundleBuiltinExtensions() {
  const results = TARGETS.map(bundleOne);
  return results;
}

// CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const results = bundleBuiltinExtensions();
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`[bundle-builtin-extensions] ${r.name}: ${r.outFile} (${r.bytes} bytes)`);
    } else {
      failed += 1;
      console.error(`[bundle-builtin-extensions] ${r.name}: FAILED — ${r.error}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`[bundle-builtin-extensions] done (${results.length - failed}/${results.length})`);
}
