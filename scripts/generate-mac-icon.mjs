#!/usr/bin/env node
// Regenerate the macOS app icon: brand glyph on a white full-bleed squircle.
// Source glyph: electron/icons/icon-source.png (dark chat-bubble π, transparent bg).
// Outputs: electron/icons/icon-{16..1024}.png, icon.png, icon.iconset/, icon.icns
// Run: node scripts/generate-mac-icon.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "electron", "icons");
const MASTER = 1024;
// macOS Big Sur+ icon corner radius ≈ 22.37% of canvas
const RADIUS = Math.round(MASTER * 0.2237);
// Glyph occupies ~76% of the canvas, centered
const GLYPH = Math.round(MASTER * 0.76);

const glyph = await sharp(path.join(iconsDir, "icon-source.png"))
  .resize(GLYPH, GLYPH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const squircle = Buffer.from(
  `<svg width="${MASTER}" height="${MASTER}"><rect x="0" y="0" width="${MASTER}" height="${MASTER}" rx="${RADIUS}" ry="${RADIUS}" fill="#ffffff"/></svg>`,
);

const master = await sharp(squircle)
  .composite([{ input: glyph, gravity: "center" }])
  .png()
  .toFile(path.join(iconsDir, "icon-1024.png"));

for (const size of [512, 256, 128, 64, 32, 16]) {
  await sharp(master.data ?? path.join(iconsDir, "icon-1024.png"))
    .resize(size, size)
    .png()
    .toFile(path.join(iconsDir, `icon-${size}.png`));
}
fs.copyFileSync(path.join(iconsDir, "icon-512.png"), path.join(iconsDir, "icon.png"));

// Rebuild the iconset from scratch (old one had misnamed/stray files).
const iconset = path.join(iconsDir, "icon.iconset");
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
const entries = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
for (const [name, size] of entries) {
  await sharp(path.join(iconsDir, "icon-1024.png"))
    .resize(size, size)
    .png()
    .toFile(path.join(iconset, name));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(iconsDir, "icon.icns")]);
console.log(`macOS icon regenerated: white squircle background, glyph centered at ${Math.round((GLYPH / MASTER) * 100)}%.`);
