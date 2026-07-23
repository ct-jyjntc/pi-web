#!/usr/bin/env node
/**
 * After `next build` (output: "standalone"), assemble the folder Electron packages:
 *   .next/standalone  +  .next/static  +  public  + full pi agent packages
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

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

// Favicon lives under app/ in this project; copy into standalone public if present
const favicon = join(root, "app", "favicon.ico");
if (existsSync(favicon)) {
  mkdirSync(targetPublic, { recursive: true });
  cpSync(favicon, join(targetPublic, "favicon.ico"));
}

// Next standalone tracing drops non-JS assets (theme JSON, export HTML templates).
// Agent session startup requires them — copy full packages over the traced ones.
const agentPkgs = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];
for (const name of agentPkgs) {
  const src = join(root, "node_modules", name);
  const dest = join(standalone, "node_modules", name);
  if (!existsSync(src)) {
    console.warn(`Warning: ${name} not found in node_modules`);
    continue;
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(standalone, "node_modules", "@earendil-works"), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied full package ${name}`);
}

// Critical asset check — missing theme JSON causes "Failed to start agent"
const darkTheme = join(
  standalone,
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json",
);
if (!existsSync(darkTheme)) {
  console.error("Missing pi-coding-agent dark.json after package copy — aborting.");
  process.exit(1);
}

console.log("Standalone bundle ready for electron-builder.");
