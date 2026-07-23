#!/usr/bin/env node
/**
 * After `next build` (output: "standalone"), assemble the folder Electron packages:
 *   .next/standalone  +  .next/static  +  public  + agent runtime assets/deps
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join, basename } from "path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");

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

function copyIfExists(src, dest) {
  if (!existsSync(src)) return false;
  ensureDir(join(dest, ".."));
  cpSync(src, dest, { recursive: true });
  return true;
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

const agentRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
const agentDest = join(standalone, "node_modules/@earendil-works/pi-coding-agent");
const standaloneNm = join(standalone, "node_modules");

// Drop package docs/examples; keep a clean slate for nested deps we re-copy selectively.
for (const junk of ["docs", "examples", "CHANGELOG.md", "README.md", "npm-shrinkwrap.json"]) {
  rmSync(join(agentDest, junk), { recursive: true, force: true });
}
rmSync(join(agentDest, "node_modules"), { recursive: true, force: true });

// Theme + export-html assets required at agent runtime (Next tracing drops non-JS files).
const assetCopies = [
  ["dist/modes/interactive/theme", "dist/modes/interactive/theme"],
  ["dist/modes/interactive/assets", "dist/modes/interactive/assets"],
  ["dist/core/export-html", "dist/core/export-html"],
];
for (const [relSrc, relDest] of assetCopies) {
  const src = join(agentRoot, relSrc);
  const dest = join(agentDest, relDest);
  if (copyIfExists(src, dest)) {
    console.log(`Copied agent assets: ${relSrc}`);
  } else {
    console.warn(`Warning: missing agent assets ${relSrc}`);
  }
}

// Nested deps that Next tracing did not hoist. Must stay under the agent package so
// version pins (e.g. glob@13) win over unrelated root packages.
const nestedSrc = join(agentRoot, "node_modules");
const nestedDest = join(agentDest, "node_modules");
let copiedNested = 0;
let skippedHoisted = 0;
if (existsSync(nestedSrc)) {
  for (const entry of readdirSync(nestedSrc)) {
    if (entry === ".bin" || entry === "@types") continue;
    const srcPath = join(nestedSrc, entry);
    // Scoped packages: @scope/*
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(srcPath)) {
        const pkgSrc = join(srcPath, scoped);
        const topLevel = join(standaloneNm, entry, scoped);
        // Always keep agent-local copy for packages that pin different majors than
        // anything that might resolve from parent walks (notably glob).
        // Prefer nested only when not already present at standalone top-level,
        // except force-copy known version-sensitive deps.
        const forceLocal = entry === "glob" || `${entry}/${scoped}` === "glob";
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

const darkTheme = join(agentDest, "dist/modes/interactive/theme/dark.json");
if (!existsSync(darkTheme)) {
  console.error("Missing pi-coding-agent dark.json after package copy — aborting.");
  process.exit(1);
}

console.log("Standalone bundle ready for electron-builder.");
