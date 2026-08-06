// electron-builder afterPack: force-copy Next standalone node_modules + bundled Node.
// FileMatcher injects an exclude for node_modules which strips deps from extraResources.
//
// macOS signing: package.json sets mac.identity to "-" (ad-hoc). electron-builder
// runs @electron/osx-sign AFTER this hook, so resource copies are included in the
// final seal. That real ad-hoc signature is what Electron 42+ UNNotification needs.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { sanitizeBundleSymlinks } from "./sanitize-bundle-symlinks.mjs";

/** Preserve relative .bin links; Node default rewrites them to absolute host paths. */
const COPY_OPTS = { recursive: true, verbatimSymlinks: true };

function ensureElectronLocales(projectDir, appOutDir, electronPlatformName, productFilename) {
  // electronLanguages uses mac-style names (en / zh_CN) that do not match Chromium
  // locale file names on Windows/Linux (en-US.pak / zh-CN.pak). If the filter
  // empties locales/, Electron paints a blank window.
  const destLocales =
    electronPlatformName === "darwin"
      ? join(appOutDir, `${productFilename}.app`, "Contents", "Resources", "locales")
      : join(appOutDir, "locales");

  let hasLocale = false;
  try {
    hasLocale = existsSync(destLocales) && readdirSync(destLocales).some((n) => n.endsWith(".pak"));
  } catch {
    hasLocale = false;
  }
  if (hasLocale) return;

  const srcLocales = join(projectDir, "node_modules", "electron", "dist", "locales");
  if (!existsSync(srcLocales)) {
    console.warn(`[afterPack] Warning: missing Electron locales at ${srcLocales}`);
    return;
  }

  const wanted = new Set([
    "en-US.pak",
    "en-GB.pak",
    "zh-CN.pak",
    "zh-TW.pak",
  ]);
  mkdirSync(destLocales, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(srcLocales)) {
    if (!wanted.has(name)) continue;
    cpSync(join(srcLocales, name), join(destLocales, name));
    copied += 1;
  }
  // Always keep en-US as a last-resort fallback.
  if (!existsSync(join(destLocales, "en-US.pak")) && existsSync(join(srcLocales, "en-US.pak"))) {
    cpSync(join(srcLocales, "en-US.pak"), join(destLocales, "en-US.pak"));
    copied += 1;
  }
  console.log(`[afterPack] Restored ${copied} Electron locale pak(s) → ${destLocales}`);
}

export default async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;

  const srcStandalone = join(projectDir, ".next", "standalone");
  const srcNm = join(srcStandalone, "node_modules");
  const srcBin = join(srcStandalone, "bin");
  if (!existsSync(srcNm)) {
    throw new Error(`Missing ${srcNm} — run npm run build:electron first`);
  }

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? join(appOutDir, `${productFilename}.app`, "Contents", "Resources")
      : join(appOutDir, "resources");

  const destStandalone = join(resourcesDir, "standalone");
  const destNm = join(destStandalone, "node_modules");
  const destBin = join(destStandalone, "bin");

  if (!existsSync(destStandalone)) {
    throw new Error(`Packaged standalone missing at ${destStandalone}`);
  }

  console.log(`[afterPack] Copying node_modules → ${destNm}`);
  rmSync(destNm, { recursive: true, force: true });
  cpSync(srcNm, destNm, COPY_OPTS);

  // The desktop runtime is the daemon (docs/desktop-architecture.md); `next` is
  // pruned unless PI_WEB_KEEP_NEXT=1. jiti is what loads the route sources, so it
  // is the dependency worth asserting on.
  if (!existsSync(join(destNm, "jiti", "package.json"))) {
    throw new Error("afterPack: jiti missing after copy — daemon cannot load app/api routes");
  }
  for (const rel of [["daemon", "ipc-host.mjs"], ["daemon", "dispatch.mjs"], ["desktop-dist", "index.html"], ["app", "api"], ["lib"]]) {
    if (!existsSync(join(destStandalone, ...rel))) {
      throw new Error(
        `afterPack: standalone/${rel.join("/")} missing — electron/main.js would fall back to Next`,
      );
    }
  }

  // Shipping TypeScript costs ~25s of blocked event loop on a cold Windows start
  // (jiti transpiles it on first hit). A tree that silently falls back to sources
  // still boots, so the shape has to be asserted rather than trusted.
  const routes = { mjs: 0, ts: 0 };
  (function countRoutes(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) countRoutes(join(dir, entry.name));
      else if (entry.name === "route.mjs") routes.mjs += 1;
      else if (entry.name === "route.ts") routes.ts += 1;
    }
  })(join(destStandalone, "app", "api"));
  if (routes.mjs === 0 || routes.ts > 0) {
    throw new Error(
      `afterPack: expected precompiled routes, found ${routes.mjs} route.mjs / ${routes.ts} route.ts — ` +
        "prepare-electron-standalone.mjs did not transpile app/api",
    );
  }
  console.log(`[afterPack] daemon payload OK (daemon, desktop-dist, app/api ${routes.mjs} ESM routes, lib, jiti)`);

  // Agent SDK must be collapsed to single-file entries (bundle-pi-sdk.mjs). A
  // tree that silently ships the multi-file package still boots — just pays the
  // install-once Defender stall the collapse exists to remove.
  const sdkStamp = join(destNm, "@earendil-works", ".pi-sdk-bundle.json");
  const agentIndex = join(destNm, "@earendil-works", "pi-coding-agent", "dist", "index.js");
  if (!existsSync(sdkStamp) || !existsSync(agentIndex)) {
    throw new Error(
      "afterPack: agent SDK bundle missing — prepare-electron-standalone did not run bundle-pi-sdk.mjs",
    );
  }
  const agentIndexBytes = statSync(agentIndex).size;
  if (agentIndexBytes < 1_000_000) {
    throw new Error(
      `afterPack: pi-coding-agent dist/index.js is only ${agentIndexBytes} bytes — expected a multi-MB single-file bundle`,
    );
  }
  console.log(`[afterPack] agent SDK bundle OK (${(agentIndexBytes / 1e6).toFixed(1)} MB index)`);

  // Self-contained runtime: Node + npm + pi shim (no system installs required).
  if (existsSync(srcBin)) {
    console.log(`[afterPack] Copying bundled runtime → ${destBin}`);
    rmSync(destBin, { recursive: true, force: true });
    cpSync(srcBin, destBin, COPY_OPTS);
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    const piName = process.platform === "win32" ? "pi.cmd" : "pi";
    if (!existsSync(join(destBin, nodeName))) {
      throw new Error(`afterPack: bundled ${nodeName} missing — run bundle-runtime-node.mjs`);
    }
    if (!existsSync(join(destBin, piName))) {
      throw new Error(`afterPack: bundled ${piName} missing — run bundle-pi-cli.mjs`);
    }
    console.log("[afterPack] standalone/bin/{node,pi} OK");
  } else {
    console.warn("[afterPack] Warning: standalone/bin missing — app will require system Node/pi");
  }

  // standalone/lib holds both the daemon's TypeScript sources and npm (official
  // Node layout puts npm at lib/node_modules/npm). extraResources filters out
  // node_modules, so copy the whole tree back.
  const srcLib = join(srcStandalone, "lib");
  if (existsSync(srcLib)) {
    const destLib = join(destStandalone, "lib");
    console.log(`[afterPack] Copying standalone/lib (daemon sources + npm) → ${destLib}`);
    rmSync(destLib, { recursive: true, force: true });
    cpSync(srcLib, destLib, COPY_OPTS);
  }

  // Drop absolute / out-of-bundle symlinks before electron-builder codesign.
  sanitizeBundleSymlinks(destStandalone, { label: "standalone (afterPack)" });

  // Git intentionally uses the system install (credential helper / Keychain).
  // Remove any leftover portable git tree from older builds.
  const destGit = join(destStandalone, "git");
  if (existsSync(destGit)) {
    rmSync(destGit, { recursive: true, force: true });
    console.log("[afterPack] Removed packaged portable git (system git only)");
  }

  ensureElectronLocales(
    projectDir,
    appOutDir,
    context.electronPlatformName,
    productFilename,
  );

  if (context.electronPlatformName === "darwin") {
    // Signing is deferred to electron-builder (mac.identity: "-") so nested
    // Electron Framework helpers are signed correctly after these copies.
    console.log(
      `[afterPack] macOS ad-hoc signing deferred to electron-builder (identity: "-") for ${productFilename}.app`,
    );
  }
}
