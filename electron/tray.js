"use strict";

/**
 * System tray owner for Windows/Linux minimize-to-tray.
 * Close hides the main BrowserWindow; tray click restores it with page state intact.
 */

const { Tray, Menu, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

/** @type {import('electron').Tray | null} */
let tray = null;

function isTraySupported() {
  return process.platform === "win32" || process.platform === "linux";
}

function getTrayIconPath() {
  const iconsDir = path.join(__dirname, "icons");
  if (process.platform === "win32") {
    const ico = path.join(iconsDir, "icon.ico");
    if (fs.existsSync(ico)) return ico;
  }
  for (const name of ["icon-32.png", "icon-16.png", "icon.png"]) {
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
    const { width } = image.getSize();
    if (width > 32) image = image.resize({ width: 32, height: 32 });
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

  // Windows: left-click restores. double-click covers some Linux DEs.
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
