#!/usr/bin/env node
/**
 * After `next build` (output: "standalone"), assemble the folder Electron packages:
 *   .next/standalone  +  .next/static  +  public  + complete pi agent packages
 *
 * Next file tracing only keeps statically-reachable JS. pi-coding-agent dynamically
 * imports modules like pi-ai/dist/oauth.js at runtime, which causes HTTP 500 in the
 * packaged app unless we overlay full package dist trees.
 *
 * Native binaries are pruned to the packaging target (host by default):
 *   PI_WEB_TARGET_PLATFORM=darwin|win32|linux
 *   PI_WEB_TARGET_ARCH=arm64|x64
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { join, basename } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");

// Packaging target for native prebuild pruning. Defaults to the build host so
// `dist:mac` on arm64 Mac only ships darwin-arm64 binaries (not win32/linux).
const targetPlatform = process.env.PI_WEB_TARGET_PLATFORM || process.platform;
const targetArch =
  process.env.PI_WEB_TARGET_ARCH ||
  (process.arch === "arm64" || process.arch === "x64" ? process.arch : "x64");
const targetTriple = `${targetPlatform}-${targetArch}`;

if (!existsSync(join(standalone, "server.js"))) {
  console.error("Missing .next/standalone/server.js — run `npm run build` first (output: standalone).");
  process.exit(1);
}

const targetStatic = join(standalone, ".next", "static");
const targetPublic = join(standalone, "public");

mkdirSync(join(standalone, ".next"), { recursive: true });

if (existsSync(staticDir)) {
  rmSync(targetStatic, { recursive: true, force: true });
  cpSync(staticDir, targetStatic, { recursive: true });
  console.log("Copied .next/static → standalone/.next/static");
} else {
  console.warn("Warning: .next/static not found");
}

if (existsSync(publicDir)) {
  rmSync(targetPublic, { recursive: true, force: true });
  cpSync(publicDir, targetPublic, { recursive: true });
  console.log("Copied public → standalone/public");
}

const favicon = join(root, "app", "favicon.ico");
if (existsSync(favicon)) {
  mkdirSync(targetPublic, { recursive: true });
  cpSync(favicon, join(targetPublic, "favicon.ico"));
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function shouldSkipBloat(src) {
  const name = basename(src);
  if (name === "README.md" || name === "CHANGELOG.md" || name === "LICENSE" || name === "LICENSE.md") return true;
  if (name.endsWith(".map") || name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return true;
  if (name === "docs" || name === "examples" || name === "test" || name === "tests" || name === "__tests__") return true;
  if (name === "@types") return true;
  return false;
}

function copyFiltered(src, dest) {
  if (!existsSync(src)) return;
  const st = statSync(src);
  if (st.isDirectory()) {
    if (shouldSkipBloat(src)) return;
    ensureDir(dest);
    for (const entry of readdirSync(src)) {
      copyFiltered(join(src, entry), join(dest, entry));
    }
    return;
  }
  if (shouldSkipBloat(src)) return;
  ensureDir(join(dest, ".."));
  cpSync(src, dest);
}

/** Drop prebuilds/* except the target platform-arch triple (e.g. darwin-arm64). */
function prunePrebuildsToTarget(pkgRoot, label = basename(pkgRoot)) {
  const pre = join(pkgRoot, "prebuilds");
  if (!existsSync(pre)) return 0;
  let removed = 0;
  for (const entry of readdirSync(pre)) {
    if (entry === targetTriple) continue;
    rmSync(join(pre, entry), { recursive: true, force: true });
    removed += 1;
  }
  if (removed > 0) {
    console.log(`Pruned ${removed} non-target prebuild(s) from ${label} (kept ${targetTriple})`);
  }
  return removed;
}

/**
 * tree-sitter-bash is only consumed via web-tree-sitter Language.load(wasm).
 * Keep package.json + the .wasm; drop native prebuilds, C sources, bindings.
 */
function slimTreeSitterBash(dest) {
  if (!existsSync(dest)) return;
  const keep = new Set(["package.json", "tree-sitter-bash.wasm"]);
  let removed = 0;
  for (const entry of readdirSync(dest)) {
    if (keep.has(entry)) continue;
    rmSync(join(dest, entry), { recursive: true, force: true });
    removed += 1;
  }
  if (!existsSync(join(dest, "tree-sitter-bash.wasm"))) {
    console.error("tree-sitter-bash.wasm missing after slim — aborting.");
    process.exit(1);
  }
  console.log(`Slimmed tree-sitter-bash to wasm-only (removed ${removed} entries)`);
}

/**
 * Keep @mariozechner/clipboard + the matching platform package
 * (clipboard-darwin-arm64, clipboard-win32-x64-msvc, clipboard-linux-x64-gnu, …).
 * Drop universal + other OS/arch optional packages.
 */
function pruneClipboardPlatformPackages(marioDir) {
  if (!existsSync(marioDir)) return 0;
  let removed = 0;
  const prefix = `${targetPlatform}-${targetArch}`;
  for (const entry of readdirSync(marioDir)) {
    if (entry === "clipboard") continue;
    if (!entry.startsWith("clipboard-")) continue;
    const rest = entry.slice("clipboard-".length);
    // Prefer arch-specific over fat universal binary.
    if (rest === "darwin-universal") {
      rmSync(join(marioDir, entry), { recursive: true, force: true });
      removed += 1;
      continue;
    }
    if (rest === prefix || rest.startsWith(`${prefix}-`)) continue;
    rmSync(join(marioDir, entry), { recursive: true, force: true });
    removed += 1;
  }
  if (removed > 0) {
    console.log(`Pruned ${removed} non-target @mariozechner/clipboard-* package(s) (target ${prefix})`);
  }
  return removed;
}

console.log(`Native prune target: ${targetTriple}`);

const standaloneNm = join(standalone, "node_modules");
const earendilRoot = join(root, "node_modules/@earendil-works");
const earendilDest = join(standaloneNm, "@earendil-works");

// Overlay full runtime trees for every @earendil-works package Next may have
// partially traced. Dynamic imports (oauth, themes, export-html, …) need this.
const piPackages = existsSync(earendilRoot)
  ? readdirSync(earendilRoot).filter((name) => {
      const p = join(earendilRoot, name);
      return statSync(p).isDirectory() && existsSync(join(p, "package.json"));
    })
  : [];

for (const name of piPackages) {
  const srcPkg = join(earendilRoot, name);
  const destPkg = join(earendilDest, name);
  ensureDir(destPkg);

  // package.json is required for resolution
  cpSync(join(srcPkg, "package.json"), join(destPkg, "package.json"));

  // Full dist (minus maps/types)
  if (existsSync(join(srcPkg, "dist"))) {
    rmSync(join(destPkg, "dist"), { recursive: true, force: true });
    copyFiltered(join(srcPkg, "dist"), join(destPkg, "dist"));
  }

  // Drop package-level junk if a previous fat copy left them
  for (const junk of ["docs", "examples", "CHANGELOG.md", "README.md", "npm-shrinkwrap.json"]) {
    rmSync(join(destPkg, junk), { recursive: true, force: true });
  }

  console.log(`Overlaid @earendil-works/${name} dist`);
}

// Nested deps under pi-coding-agent: Next often misses version-pinned ones
// (glob@13) and optional runtime packages.
const agentRoot = join(earendilRoot, "pi-coding-agent");
const agentDest = join(earendilDest, "pi-coding-agent");
const nestedSrc = join(agentRoot, "node_modules");
const nestedDest = join(agentDest, "node_modules");

rmSync(nestedDest, { recursive: true, force: true });

let copiedNested = 0;
let skippedHoisted = 0;
if (existsSync(nestedSrc)) {
  for (const entry of readdirSync(nestedSrc)) {
    if (entry === ".bin" || entry === "@types") continue;
    const srcPath = join(nestedSrc, entry);

    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(srcPath)) {
        // Never nest another full @earendil-works tree (already overlaid top-level)
        if (entry === "@earendil-works") {
          skippedHoisted++;
          continue;
        }
        const pkgSrc = join(srcPath, scoped);
        const topLevel = join(standaloneNm, entry, scoped);
        const forceLocal = entry === "glob";
        if (!forceLocal && existsSync(topLevel)) {
          skippedHoisted++;
          continue;
        }
        copyFiltered(pkgSrc, join(nestedDest, entry, scoped));
        copiedNested++;
      }
      continue;
    }

    const topLevel = join(standaloneNm, entry);
    const forceLocal = entry === "glob";
    if (!forceLocal && existsSync(topLevel)) {
      skippedHoisted++;
      continue;
    }
    copyFiltered(srcPath, join(nestedDest, entry));
    copiedNested++;
  }

  // Always force glob@13 under the agent package (project root may have glob@7).
  const globSrc = join(nestedSrc, "glob");
  if (existsSync(globSrc)) {
    rmSync(join(nestedDest, "glob"), { recursive: true, force: true });
    copyFiltered(globSrc, join(nestedDest, "glob"));
    console.log("Forced nested glob@13 for pi-coding-agent");
  }
}

console.log(`Nested agent deps: copied ${copiedNested}, skipped hoisted ${skippedHoisted}`);

// Optional native clipboard packages ship for every OS under the agent tree.
pruneClipboardPlatformPackages(join(nestedDest, "@mariozechner"));
pruneClipboardPlatformPackages(join(standaloneNm, "@mariozechner"));

// First-party agent extensions ship as app dependencies (not ~/.pi/agent/npm).
// The SDK JIT-loads their TypeScript entry files via jiti, so Next file-tracing
// will not pull them in — overlay the full package trees + heavy runtime deps.
const builtinExtensionPackages = [
  "@gotgenes/pi-permission-system",
  "@gotgenes/pi-subagents",
  "pi-mcp-adapter",
  "web-tree-sitter",
  "tree-sitter-bash",
];

function overlayPackageTree(pkgName) {
  const src = join(root, "node_modules", ...pkgName.split("/"));
  const dest = join(standaloneNm, ...pkgName.split("/"));
  if (!existsSync(src)) {
    console.warn(`Warning: builtin package missing: ${pkgName}`);
    return false;
  }
  rmSync(dest, { recursive: true, force: true });
  // Keep sources (.ts) and wasm assets — jiti + tree-sitter need them.
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const name = basename(p);
      if (name === "README.md" || name === "CHANGELOG.md" || name === "LICENSE" || name === "LICENSE.md") return false;
      if (name.endsWith(".map") || name.endsWith(".d.ts") || name.endsWith(".d.mts")) return false;
      if (name === "docs" || name === "examples" || name === "test" || name === "tests" || name === "__tests__") return false;
      if (name === ".github") return false;
      return true;
    },
  });
  return true;
}

let builtinCopied = 0;
for (const name of builtinExtensionPackages) {
  if (overlayPackageTree(name)) builtinCopied += 1;
}
console.log(`Overlaid ${builtinCopied}/${builtinExtensionPackages.length} builtin extension packages`);

// The .pi-web-bundle files are built with esbuild `packages: "external"`, so every
// runtime dependency has to really exist under standalone/node_modules. Next's
// tracing cannot see through the dynamic `import(href)` that loads a bundle, which
// left `zod` as a package.json-only stub and `@sinclair/typebox` absent entirely —
// the packaged app then booted with no permission system, no subagents and no MCP.
// Re-copy from the project tree rather than trusting whatever tracing produced.
function stageExtensionRuntimeDeps(rootPackages) {
  const roots = new Set(rootPackages);
  const seen = new Set(rootPackages);
  const queue = [...rootPackages];
  const staged = [];
  const missing = [];

  while (queue.length > 0) {
    const name = queue.shift();
    const src = join(root, "node_modules", ...name.split("/"));
    const manifest = join(src, "package.json");
    if (!existsSync(manifest)) {
      if (!roots.has(name)) missing.push(name);
      continue;
    }

    if (!roots.has(name)) {
      const dest = join(standaloneNm, ...name.split("/"));
      rmSync(dest, { recursive: true, force: true });
      copyFiltered(src, dest);
      staged.push(name);
    }

    let deps = {};
    try {
      deps = JSON.parse(readFileSync(manifest, "utf8")).dependencies ?? {};
    } catch {
      // An unreadable manifest just ends this branch of the walk.
    }
    for (const dep of Object.keys(deps)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(dep);
    }
  }
  return { staged, missing };
}

{
  const { staged, missing } = stageExtensionRuntimeDeps(builtinExtensionPackages);
  console.log(`Staged ${staged.length} builtin extension runtime deps`);
  if (missing.length > 0) {
    // Optional peers resolve to nothing; a real miss shows up as an extension
    // failing to load at runtime, so surface the list either way.
    console.warn(`Warning: unresolved extension deps: ${missing.join(", ")}`);
  }
}

// permission-system loads bash grammar via web-tree-sitter + .wasm only.
slimTreeSitterBash(join(standaloneNm, "tree-sitter-bash"));

// Ensure heavy extension prebundles exist (extensionFactories path — no jiti at runtime).
// Prefer already-built .pi-web-bundle under project node_modules; re-run script if missing.
{
  const needsBundle = builtinExtensionPackages.some((name) => {
    const bundle = join(root, "node_modules", ...name.split("/"), ".pi-web-bundle", "extension.mjs");
    return !existsSync(bundle);
  });
  if (needsBundle) {
    console.log("Building missing heavy extension prebundles…");
    const r = spawnSync(process.execPath, [join(root, "scripts", "bundle-builtin-extensions.mjs")], {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (r.status !== 0) {
      console.warn("Warning: bundle-builtin-extensions failed — runtime may fall back to jiti TS paths");
    }
  }
  // Copy .pi-web-bundle dirs into standalone tree (overlayPackageTree filter may have skipped).
  for (const name of builtinExtensionPackages) {
    const srcBundle = join(root, "node_modules", ...name.split("/"), ".pi-web-bundle");
    const destBundle = join(standaloneNm, ...name.split("/"), ".pi-web-bundle");
    if (!existsSync(srcBundle)) {
      console.warn(`Warning: missing prebundle for ${name}`);
      continue;
    }
    rmSync(destBundle, { recursive: true, force: true });
    cpSync(srcBundle, destBundle, { recursive: true });
    console.log(`Copied prebundle ${name}/.pi-web-bundle`);
  }
}

// node-pty: Next file-tracing keeps only package.json + lib/, but the native
// prebuilds/ (pty.node + spawn-helper) are required at runtime in the packaged app.
// Copy then prune to the packaging target so mac-arm64 does not ship ~58M of win32.
const nodePtySrc = join(root, "node_modules", "node-pty");
const nodePtyDest = join(standaloneNm, "node-pty");
if (existsSync(nodePtySrc)) {
  rmSync(nodePtyDest, { recursive: true, force: true });
  cpSync(nodePtySrc, nodePtyDest, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      if (name === "README.md" || name === "CHANGELOG.md" || name === "LICENSE") return false;
      if (name.endsWith(".map") || name.endsWith(".d.ts")) return false;
      if (name === "docs" || name === "examples" || name === "test" || name === "tests") return false;
      // Build-only trees — runtime uses prebuilds/ + lib/.
      if (name === "src" || name === "deps" || name === "scripts" || name === "typings") return false;
      if (name === "binding.gyp") return false;
      // winpty/conpty are Windows-only.
      if (name === "third_party" && targetPlatform !== "win32") return false;
      // Skip foreign prebuild dirs while copying (faster than copy-all + delete).
      const parent = basename(join(src, ".."));
      if (parent === "prebuilds" && name !== targetTriple && statSync(src).isDirectory()) return false;
      return true;
    },
  });

  prunePrebuildsToTarget(nodePtyDest, "node-pty");

  // npm/cp can strip +x from spawn-helper → opaque "posix_spawnp failed".
  const fixHelper = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        fixHelper(full);
        continue;
      }
      if (entry.name === "spawn-helper") {
        try {
          const mode = statSync(full).mode;
          chmodSync(full, mode | 0o755);
        } catch {
          // ignore
        }
      }
    }
  };
  fixHelper(join(nodePtyDest, "prebuilds"));
  fixHelper(join(nodePtyDest, "build"));

  const targetPty = join(nodePtyDest, "prebuilds", targetTriple, "pty.node");
  if (!existsSync(targetPty)) {
    console.error(`node-pty prebuild missing for ${targetTriple} after overlay — aborting.`);
    process.exit(1);
  }
  console.log(`Overlaid node-pty with ${targetTriple} prebuilds only`);
} else {
  console.warn("Warning: node_modules/node-pty not found — terminal PTY will not work in package");
}

// Critical asset checks
const darkTheme = join(agentDest, "dist/modes/interactive/theme/dark.json");
const oauthJs = join(earendilDest, "pi-ai/dist/oauth.js");
if (!existsSync(darkTheme)) {
  console.error("Missing pi-coding-agent dark.json after package copy — aborting.");
  process.exit(1);
}
if (!existsSync(oauthJs)) {
  console.error("Missing pi-ai oauth.js after package copy — aborting.");
  process.exit(1);
}

// ── Desktop daemon runtime (Phase B) ────────────────────────────────────────
// electron/main.js requires daemon/ipc-host.mjs + desktop-dist
// over the Next standalone server, but neither was ever staged here — so every
// packaged build silently fell back to booting Next, which preloads all ~80 route
// entries before it can answer /api/health. That fallback is the packaged cold
// start. Ship the daemon payload so the packaged app takes the same path
// `npm run electron` already takes. See docs/desktop-architecture.md.
//
// app/api and lib used to ship as TypeScript for the daemon to jiti-transpile at
// runtime. On a cold Windows install that cost ~25s of blocked event loop for the
// first route that pulled the model stack — the SDK module graph itself is only
// ~2s of it. Transpiling here instead leaves jiti doing plain module resolution.
//
// ESM output specifically: CJS output makes jiti `require()` the ESM-only agent
// SDK, which drags all of node_modules through babel and measured ~2x SLOWER than
// shipping TypeScript. Keep the emitted format ESM.
const SOURCE_EXTS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json"]);
const TRANSPILE_EXTS = new Set([".ts", ".tsx"]);

function collectSources(src, dest, out = { transpile: [], copy: [] }) {
  if (!existsSync(src)) return out;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      collectSources(from, join(dest, entry.name), out);
      continue;
    }
    // Tests never run from the package and would drag in dev-only imports.
    if (entry.name.includes(".test.")) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0 || !SOURCE_EXTS.has(entry.name.slice(dot))) continue;
    if (TRANSPILE_EXTS.has(entry.name.slice(dot))) out.transpile.push(from);
    else out.copy.push({ from, to: join(dest, entry.name) });
  }
  return out;
}

/** Verbatim copy — used for daemon/, which is already plain ESM. */
function copySources(src, dest) {
  const { transpile, copy } = collectSources(src, dest);
  const files = [
    ...copy,
    ...transpile.map((from) => ({ from, to: join(dest, from.slice(src.length + 1)) })),
  ];
  for (const file of files) {
    ensureDir(join(file.to, ".."));
    cpSync(file.from, file.to);
  }
  return files.length;
}

/**
 * Transpile a source tree to ESM the daemon can load without a TypeScript pass.
 * Emits .mjs so daemon/routes.mjs picks route.mjs over any stale route.ts.
 */
function transpileSources(src, dest, label) {
  const { transpile, copy } = collectSources(src, dest);
  if (transpile.length > 0) {
    const esbuild = require("esbuild");
    esbuild.buildSync({
      entryPoints: transpile,
      outdir: dest,
      outbase: src,
      bundle: false,
      format: "esm",
      platform: "node",
      target: "node22",
      sourcemap: false,
      outExtension: { ".js": ".mjs" },
      logLevel: "warning",
    });
  }
  for (const file of copy) {
    ensureDir(join(file.to, ".."));
    cpSync(file.from, file.to);
  }
  console.log(`Transpiled ${label} → ESM (${transpile.length} modules, ${copy.length} copied)`);
  return transpile.length + copy.length;
}

const daemonSrc = join(root, "daemon");
const desktopDistSrc = join(root, "desktop-dist");

if (!existsSync(join(daemonSrc, "ipc-host.mjs"))) {
  console.error("Missing daemon/ipc-host.mjs — cannot package the desktop runtime.");
  process.exit(1);
}
if (!existsSync(join(desktopDistSrc, "index.html"))) {
  console.error("Missing desktop-dist/index.html — run `npm run desktop:build` first.");
  process.exit(1);
}

rmSync(join(standalone, "daemon"), { recursive: true, force: true });
const daemonFiles = copySources(daemonSrc, join(standalone, "daemon"));
console.log(`Copied daemon → standalone/daemon (${daemonFiles} files)`);

// Source maps are 3/4 of desktop-dist and are dead weight in an installer.
const desktopDest = join(standalone, "desktop-dist");
rmSync(desktopDest, { recursive: true, force: true });
let skippedMaps = 0;
cpSync(desktopDistSrc, desktopDest, {
  recursive: true,
  filter: (src) => {
    if (src.endsWith(".map")) {
      skippedMaps += 1;
      return false;
    }
    return true;
  },
});
console.log(`Copied desktop-dist → standalone/desktop-dist (skipped ${skippedMaps} source maps)`);

rmSync(join(standalone, "app", "api"), { recursive: true, force: true });
transpileSources(join(root, "app", "api"), join(standalone, "app", "api"), "app/api");

// NOTE: bundle-runtime-node.mjs later writes npm into standalone/lib/node_modules.
// It runs after this script and only removes its own subtree, so the two coexist.
rmSync(join(standalone, "lib"), { recursive: true, force: true });
transpileSources(join(root, "lib"), join(standalone, "lib"), "lib");

// jiti stays a devDependency (the published npm package ships .next, not daemon/),
// so it is staged here rather than traced in by Next.
const jitiSrc = join(root, "node_modules", "jiti");
if (!existsSync(jitiSrc)) {
  console.error("Missing node_modules/jiti — the daemon cannot load route sources.");
  process.exit(1);
}
rmSync(join(standaloneNm, "jiti"), { recursive: true, force: true });
copyFiltered(jitiSrc, join(standaloneNm, "jiti"));
console.log("Copied jiti → standalone/node_modules/jiti");

// ── Drop the Next server ────────────────────────────────────────────────────
// Nothing under app/api or lib imports anything but `next/server`, which
// daemon/shims/next-server.mjs replaces. Keeping the framework would ship ~1.9k
// files / ~80MB that only exist to be scanned by Defender on first launch.
// PI_WEB_KEEP_NEXT=1 produces a fallback build that can still run PI_WEB_RUNTIME=next.
// Removal condition: delete this switch once a daemon-only release has shipped.
if (process.env.PI_WEB_KEEP_NEXT === "1") {
  console.log("PI_WEB_KEEP_NEXT=1 — keeping the Next standalone server as a fallback");
} else {
  for (const rel of [["node_modules", "next"], [".next"], ["server.js"]]) {
    rmSync(join(standalone, ...rel), { recursive: true, force: true });
  }
  console.log("Pruned Next standalone server (node_modules/next, .next, server.js)");
}


console.log("Standalone bundle ready — next: bundle-runtime-node.mjs (ships Node so users need no system Node).");
console.log("Standalone package tree prepared for electron-builder.");
