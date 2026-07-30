#!/usr/bin/env node
/**
 * Standalone Electron main-process notification probe (macOS UNNotification / ad-hoc).
 * Run: node scripts/smoke-electron-notify.mjs
 * Or:  electron scripts/smoke-electron-notify.mjs  (when used as electron entry)
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// When launched by Electron as the app entry, process.versions.electron is set.
const isElectron = Boolean(process.versions.electron);

if (!isElectron) {
  const electronBin = join(root, "node_modules", ".bin", "electron");
  const child = spawn(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const { app, Notification } = require("electron");
  app.whenReady().then(() => {
    const supported = Notification.isSupported();
    if (!supported) {
      console.log(JSON.stringify({ ok: false, supported, events: ["unsupported"] }));
      app.exit(1);
      return;
    }
    const events = [];
    const n = new Notification({
      title: "Pi Web smoke",
      body: "Electron 43 ad-hoc notification probe",
      silent: true,
    });
    const finish = (code) => {
      console.log(JSON.stringify({ ok: code === 0, supported, events }));
      setTimeout(() => app.exit(code), 30);
    };
    n.on("show", () => {
      events.push("show");
      finish(0);
    });
    n.on("failed", (_e, err) => {
      events.push(`failed:${err}`);
      finish(1);
    });
    setTimeout(() => {
      if (!events.length) {
        events.push("timeout-no-show");
        // On macOS with Focus modes, show may be delayed; signature failure is explicit.
        finish(0);
      }
    }, 2500);
    n.show();
  });
}
