"use strict";

/**
 * System tray / menu-bar owner for minimize-to-tray on all desktop platforms.
 * Close hides the main BrowserWindow; tray click restores it with page state intact.
 * macOS: status-item in the menu bar. Windows/Linux: notification-area tray icon.
 */

const { Tray, Menu, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

/** @type {import('electron').Tray | null} */
let tray = null;

function isTraySupported() {
  return process.platform === "win32" || process.platform === "linux" || process.platform === "darwin";
}

function getTrayIconPath() {
  const iconsDir = path.join(__dirname, "icons");
  if (process.platform === "win32") {
    const ico = path.join(iconsDir, "icon.ico");
    if (fs.existsSync(ico)) return ico;
  }
  // macOS menu bar prefers a compact bitmap; 16/32 look sharper than the 512 source.
  const preferred =
    process.platform === "darwin"
      ? ["icon-16.png", "icon-32.png", "icon.png"]
      : ["icon-32.png", "icon-16.png", "icon.png"];
  for (const name of preferred) {
    const candidate = path.join(iconsDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(iconsDir, "icon.png");
}

/**
 * Create (or reuse) the tray icon.
 * @param {{
 *   showMainWindow: () => void,
 *   quitApp: () => void,
 * }} deps
 */
function ensureTray(deps) {
  if (!isTraySupported()) return null;
  if (tray) return tray;

  const iconPath = getTrayIconPath();
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty() && process.platform !== "win32") {
    // Menu bar / tray bitmaps: 16–22 logical px; 32 covers @2x without looking huge.
    const target = process.platform === "darwin" ? 16 : 32;
    const { width } = image.getSize();
    if (width > target) image = image.resize({ width: target, height: target });
  }

  tray = image.isEmpty() ? new Tray(iconPath) : new Tray(image);
  tray.setToolTip("Pi Web");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Pi Web",
        click: () => deps.showMainWindow(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => deps.quitApp(),
      },
    ]),
  );

  // Windows/Linux: left-click restores. double-click covers some Linux DEs.
  // macOS: left-click often opens the context menu when one is set; click still restores when it fires.
  tray.on("click", () => deps.showMainWindow());
  tray.on("double-click", () => deps.showMainWindow());
  return tray;
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch {
    // ignore
  }
  tray = null;
}

module.exports = {
  isTraySupported,
  ensureTray,
  destroyTray,
};
