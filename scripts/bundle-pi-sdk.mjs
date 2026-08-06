#!/usr/bin/env node
/**
 * Collapse @earendil-works agent packages to single-file ESM entry points.
 *
 * Why: a packaged Windows install pays one Defender + filesystem hit per JS
 * file the first time the agent SDK loads. The coding-agent graph alone is
 * thousands of files once nested deps are counted. esbuild can statically
 * bundle what the app reaches into a handful of files.
 *
 * Strategy:
 *   - pi-coding-agent index + cli are fully inlined (including pi-ai /
 *     agent-core / tui). This is the cold-start hot path.
 *   - Direct app imports of pi-ai / agent-core / tui get their own single-file
 *     entries so those routes stay fast too. They are separate module
 *     instances from the inlined copies inside coding-agent — the app only
 *     crosses that boundary with plain data (models, credentials), not
 *     `instanceof` checks against SDK classes.
 *   - Only coding-agent's multi-file dist JS is pruned after bundling. Sibling
 *     packages keep residual files so any deep subpath export still resolves.
 *
 * Applied only to a *target* tree (the Electron standalone payload). Project
 * node_modules used for dev is left alone.
 *
 * Usage:
 *   node scripts/bundle-pi-sdk.mjs [--target <standalone-root>]
 *   Default --target: .next/standalone
 */
import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let target = join(root, ".next", "standalone");
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--target" && argv[i + 1]) {
      target = argv[++i];
    }
  }
  return { target };
}

const { target: targetRoot } = parseArgs(process.argv.slice(2));
const srcNm = join(root, "node_modules");
const destNm = join(targetRoot, "node_modules");

const NATIVE_EXTERNAL = [
  "node-pty",
  "web-tree-sitter",
  "tree-sitter-*",
  "*.node",
  // Loaded via createRequire / path lookup; keep the real package on disk.
  "@silvia-odwyer/photon-node",
  "@mariozechner/clipboard",
  "@mariozechner/clipboard-*",
];

/**
 * createRequire banner: the SDK still contains CJS that calls require();
 * esbuild's ESM output otherwise emits a stub that throws on the first one.
 */
const REQUIRE_BANNER = [
  'import { createRequire as __pwCreateRequire } from "node:module";',
  "const require = __pwCreateRequire(import.meta.url);",
].join("\n");

/** @type {Array<{ pkg: string, entry: string, outfile: string }>} */
const ENTRIES = [
  // Direct app imports (models routes, providers, TUI keybindings).
  { pkg: "@earendil-works/pi-ai", entry: "dist/index.js", outfile: "dist/index.js" },
  { pkg: "@earendil-works/pi-ai", entry: "dist/compat.js", outfile: "dist/compat.js" },
  { pkg: "@earendil-works/pi-ai", entry: "dist/oauth.js", outfile: "dist/oauth.js" },
  {
    pkg: "@earendil-works/pi-ai",
    entry: "dist/api/openai-completions.lazy.js",
    outfile: "dist/api/openai-completions.lazy.js",
  },
  { pkg: "@earendil-works/pi-agent-core", entry: "dist/index.js", outfile: "dist/index.js" },
  { pkg: "@earendil-works/pi-agent-core", entry: "dist/node.js", outfile: "dist/node.js" },
  { pkg: "@earendil-works/pi-tui", entry: "dist/index.js", outfile: "dist/index.js" },
  // Cold-start hot path — fully inlined, no @earendil-works externals.
  // entry is a local wrapper that registers static OAuth loaders (see
  // coding-agent-bundle-entry.mjs) before re-exporting the real SDK index.
  {
    pkg: "@earendil-works/pi-coding-agent",
    entry: join(root, "scripts", "coding-agent-bundle-entry.mjs"),
    outfile: "dist/index.js",
    entryIsAbsolute: true,
  },
  // Subagent `pi` shim points at dist/cli.js.
  { pkg: "@earendil-works/pi-coding-agent", entry: "dist/cli.js", outfile: "dist/cli.js" },
];

/** Only coding-agent's multi-file dist is safe to delete after a full inline. */
const PRUNE_PACKAGES = ["@earendil-works/pi-coding-agent"];

const KEEP_JS = new Set(["dist/index.js", "dist/cli.js"]);

function pkgPath(nm, name) {
  return join(nm, ...name.split("/"));
}

function assertSourcePackages() {
  const names = new Set(ENTRIES.map((e) => e.pkg));
  for (const name of names) {
    const pkgJson = join(pkgPath(srcNm, name), "package.json");
    if (!existsSync(pkgJson)) {
      throw new Error(`bundle-pi-sdk: missing source package ${name}`);
    }
  }
}

/**
 * Drop every coding-agent dist JS file the bundle replaced. Assets (themes,
 * export-html templates, images) stay so getPackageDir() resolution works.
 */
function pruneCollapsedJs(pkgDest) {
  let removed = 0;
  function walk(dir, relBase) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full, rel);
        try {
          if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true });
        } catch {
          // ignore
        }
        continue;
      }
      const isJs =
        entry.name.endsWith(".js") || entry.name.endsWith(".mjs") || entry.name.endsWith(".cjs");
      const isMap = entry.name.endsWith(".map");
      const isDts = /\.d\.(ts|mts|cts)$/.test(entry.name);
      if (!isJs && !isMap && !isDts) continue;
      const keepKey = rel.replace(/\\/g, "/");
      if (isJs && KEEP_JS.has(keepKey)) continue;
      rmSync(full, { force: true });
      removed += 1;
    }
  }
  walk(join(pkgDest, "dist"), "dist");
  return removed;
}

/**
 * Nested deps under coding-agent (AWS SDK copies, etc.) are inlined into the
 * bundle. Drop them; keep nested glob@13 when the overlay forced it.
 */
function pruneAgentNestedModules(agentDest, standaloneNm) {
  const nested = join(agentDest, "node_modules");
  if (!existsSync(nested)) return 0;

  const nestedGlob = join(nested, "glob");
  let savedGlob = null;
  if (existsSync(nestedGlob)) {
    savedGlob = join(agentDest, ".glob-preserve");
    rmSync(savedGlob, { recursive: true, force: true });
    cpSync(nestedGlob, savedGlob, { recursive: true });
  }

  let count = 0;
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else count += 1;
    }
  })(nested);
  rmSync(nested, { recursive: true, force: true });

  if (savedGlob) {
    mkdirSync(join(agentDest, "node_modules"), { recursive: true });
    cpSync(savedGlob, join(agentDest, "node_modules", "glob"), { recursive: true });
    rmSync(savedGlob, { recursive: true, force: true });
  }
  return count;
}

async function bundleOne(job) {
  const srcEntry = job.entryIsAbsolute ? job.entry : join(pkgPath(srcNm, job.pkg), job.entry);
  const destFile = join(pkgPath(destNm, job.pkg), job.outfile);
  if (!existsSync(srcEntry)) {
    throw new Error(`bundle-pi-sdk: missing entry ${srcEntry}`);
  }
  if (!existsSync(pkgPath(destNm, job.pkg))) {
    throw new Error(
      `bundle-pi-sdk: target package missing ${job.pkg} under ${destNm} — run package overlay first`,
    );
  }
  mkdirSync(dirname(destFile), { recursive: true });

  const t0 = Date.now();
  const result = await build({
    entryPoints: [srcEntry],
    outfile: destFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    banner: { js: REQUIRE_BANNER },
    external: NATIVE_EXTERNAL,
    logLevel: "warning",
    metafile: true,
  });
  const size = statSync(destFile).size;
  const inputs = Object.keys(result.metafile.inputs).length;
  console.log(
    `  ${job.pkg} ${job.outfile}: ${(size / 1e6).toFixed(2)} MB from ${inputs} inputs in ${Date.now() - t0}ms`,
  );
  return { destFile, size, inputs };
}

/**
 * Smoke: ModelRuntime.login must not resolve relative OAuth modules against
 * coding-agent/dist (the pruned single-file layout). Static registration makes
 * loadAnthropicOAuth etc. return in-memory loaders.
 */
async function verifyOAuthLoginLoads(agentIndex) {
  const href = pathToFileURL(agentIndex).href;
  const mod = await import(`${href}?oauth-verify=${Date.now()}`);
  if (typeof mod.ModelRuntime?.create !== "function") {
    throw new Error("bundle-pi-sdk: ModelRuntime missing from bundled coding-agent index");
  }
  const runtime = await mod.ModelRuntime.create();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 800);
  try {
    await runtime.login("anthropic", "oauth", {
      signal: ac.signal,
      notify: () => {},
      prompt: async () => {
        ac.abort();
        throw new Error("oauth-verify-abort");
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Cannot find module") && message.includes("anthropic.js")) {
      throw new Error(
        `bundle-pi-sdk: OAuth still dynamic-imports missing coding-agent/dist/anthropic.js — ${message}`,
      );
    }
    // Abort / user-cancel / callback races are expected; only MODULE_NOT_FOUND is fatal.
  } finally {
    clearTimeout(timer);
  }
  console.log("  oauth verify: anthropic login no longer misses dist/anthropic.js");
}

async function main() {
  if (!existsSync(destNm)) {
    console.error(`bundle-pi-sdk: target node_modules missing at ${destNm}`);
    process.exit(1);
  }
  assertSourcePackages();

  console.log(`Bundling agent SDK into ${relative(root, targetRoot) || "."}`);
  const t0 = Date.now();
  for (const job of ENTRIES) {
    await bundleOne(job);
  }

  let prunedJs = 0;
  for (const name of PRUNE_PACKAGES) {
    prunedJs += pruneCollapsedJs(pkgPath(destNm, name));
  }
  const nestedDropped = pruneAgentNestedModules(
    pkgPath(destNm, "@earendil-works/pi-coding-agent"),
    destNm,
  );

  const stamp = {
    bundledAt: new Date().toISOString(),
    entries: ENTRIES.map((e) => `${e.pkg}/${e.outfile}`),
    prunedJsFiles: prunedJs,
    prunedAgentNestedFiles: nestedDropped,
  };
  writeFileSync(join(destNm, "@earendil-works", ".pi-sdk-bundle.json"), JSON.stringify(stamp, null, 2));

  // Hard checks the runtime will hit on first theme / CLI use.
  const agentDist = join(pkgPath(destNm, "@earendil-works/pi-coding-agent"), "dist");
  for (const rel of [
    "index.js",
    "cli.js",
    "modes/interactive/theme/dark.json",
    "modes/interactive/theme/light.json",
  ]) {
    if (!existsSync(join(agentDist, rel))) {
      throw new Error(`bundle-pi-sdk: missing ${rel} after bundle`);
    }
  }

  await verifyOAuthLoginLoads(join(agentDist, "index.js"));

  console.log(
    `SDK bundle done in ${Date.now() - t0}ms (pruned ${prunedJs} coding-agent dist JS/maps, dropped ${nestedDropped} nested agent files)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
