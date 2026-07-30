// electron-builder afterPack: force-copy Next standalone node_modules + bundled Node.
// FileMatcher injects an exclude for node_modules which strips deps from extraResources.
//
// macOS signing: package.json sets mac.identity to "-" (ad-hoc). electron-builder
// runs @electron/osx-sign AFTER this hook, so resource copies are included in the
// final seal. That real ad-hoc signature is what Electron 42+ UNNotification needs.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";

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
  cpSync(srcNm, destNm, { recursive: true });

  if (!existsSync(join(destNm, "next", "package.json"))) {
    throw new Error("afterPack: next package still missing after copy");
  }
  console.log("[afterPack] standalone/node_modules/next OK");

  // Self-contained runtime: Node + npm + pi shim (no system installs required).
  if (existsSync(srcBin)) {
    console.log(`[afterPack] Copying bundled runtime → ${destBin}`);
    rmSync(destBin, { recursive: true, force: true });
    cpSync(srcBin, destBin, { recursive: true });
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

  // npm lives under standalone/lib/node_modules/npm in the official Node layout.
  const srcLib = join(srcStandalone, "lib");
  if (existsSync(srcLib)) {
    const destLib = join(destStandalone, "lib");
    console.log(`[afterPack] Copying bundled lib (npm) → ${destLib}`);
    rmSync(destLib, { recursive: true, force: true });
    cpSync(srcLib, destLib, { recursive: true });
  }

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
