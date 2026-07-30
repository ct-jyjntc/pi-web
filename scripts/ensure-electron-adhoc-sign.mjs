#!/usr/bin/env node
/**
 * Re-sign node_modules Electron.app with real ad-hoc when needed.
 * Required for Electron 42+ macOS notifications during `npm run electron`.
 * Skips when already properly ad-hoc signed (avoids Keychain churn).
 */
import { existsSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { adhocSign } from "./macos-adhoc-sign.mjs";

if (process.platform !== "darwin") process.exit(0);

const require = createRequire(import.meta.url);

function resolveElectronApp() {
  try {
    const electronRoot = dirname(require.resolve("electron/package.json"));
    const appPath = join(electronRoot, "dist", "Electron.app");
    if (existsSync(appPath)) return appPath;
  } catch {
    // fall through
  }
  const fallback = join(process.cwd(), "node_modules", "electron", "dist", "Electron.app");
  return existsSync(fallback) ? fallback : null;
}

const appPath = resolveElectronApp();
if (!appPath) {
  // Electron not installed yet (e.g. npm install mid-flight) — ignore.
  process.exit(0);
}

try {
  adhocSign(appPath, { label: "Electron.app (dev)" });
} catch (error) {
  // Dev convenience only — do not hard-fail install on machines without codesign.
  console.warn(
    "[ensure-electron-adhoc-sign]",
    error instanceof Error ? error.message : error,
  );
}
