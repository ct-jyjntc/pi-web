#!/usr/bin/env node
/**
 * After `next build` (output: "standalone"), assemble the folder Electron packages:
 *   .next/standalone  +  .next/static  +  public  + complete pi agent packages
 *
 * Next file tracing only keeps statically-reachable JS. pi-coding-agent dynamically
 * imports modules like pi-ai/dist/oauth.js at runtime, which causes HTTP 500 in the
 * packaged app unless we overlay full package dist trees.
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

console.log("Standalone bundle ready for electron-builder.");
