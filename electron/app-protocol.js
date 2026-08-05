"use strict";
/**
 * Serves the renderer bundle from the main process over `app://pi/`.
 *
 * Previously the agent runtime served these files over HTTP, which meant a
 * synchronous SDK load in that process stalled the code-split chunks the window
 * needs to render — the window appeared instantly and then sat empty. Assets now
 * come from Electron's own event loop and cannot be blocked by agent work.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { protocol, net } = require("electron");

const SCHEME = "app";
const HOST = "pi";
const ORIGIN = `${SCHEME}://${HOST}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

/**
 * Must run before `app.whenReady()`. `standard` gives the scheme a real origin
 * (so it can host a SPA and use fetch/EventSource semantics); `secure` keeps it
 * out of Chromium's mixed-content and insecure-origin restrictions.
 */
function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
      scheme: SCHEME,
    },
  ]);
}

/**
 * Resolve a URL path inside the bundle, refusing anything that escapes it.
 * @param {string} distDir
 * @param {string} pathname
 */
function resolveAsset(distDir, pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const full = path.resolve(distDir, decoded);
  const relative = path.relative(distDir, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return full;
}

/** @param {string} distDir */
function serveAppProtocol(distDir) {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let filePath = resolveAsset(distDir, url.pathname);

    // SPA: unknown paths are client routes, not 404s.
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, "index.html");
    }
    if (!fs.existsSync(filePath)) {
      return new Response("Desktop UI not built — run npm run desktop:build", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    // Hashed asset names are immutable; index.html must not be cached or an
    // upgraded app would keep booting the previous bundle.
    const cacheControl = path.basename(filePath) === "index.html"
      ? "no-store"
      : "public, max-age=31536000, immutable";
    try {
      const body = await fsp.readFile(filePath);
      return new Response(body, { headers: { "content-type": type, "cache-control": cacheControl } });
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  });
}

module.exports = { registerAppScheme, serveAppProtocol, APP_ORIGIN: ORIGIN, APP_SCHEME: SCHEME };
