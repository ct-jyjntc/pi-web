#!/usr/bin/env node
/**
 * Pi Web desktop daemon — no Next.js runtime.
 * Serves desktop-dist static UI + dispatches app/api route.ts handlers via jiti.
 *
 * Invariant: process must accept HTTP (at least /api/health) before any
 * heavy jiti/SDK work. Security helpers and route modules load on demand.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { discoverApiRoutes, matchRoute } from "./routes.mjs";
import { NextRequest } from "./shims/next-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const HOST = process.env.HOSTNAME || process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || process.env.PI_WEB_PORT || 30142);
const desktopDist = path.resolve(
  process.env.PI_WEB_DESKTOP_DIST || path.join(root, "desktop-dist"),
);

const bootStarted = Date.now();

/** @type {import('./routes.mjs').RouteEntry[]} */
const routes = discoverApiRoutes(root);

// ── jiti (created once; modules still lazy) ─────────────────────────────────
const { createJiti } = require("jiti");
const nextShim = path.join(__dirname, "shims", "next-server.mjs");
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: {
    "@": root,
    "next/server": nextShim,
  },
});

/** @type {null | {
 *   isApiRequestAllowed: (req: Request) => boolean,
 *   isApiRequestHostAllowed: (req: Request) => boolean,
 *   isValidBasicAuthorization: (h: string | null, p: string | undefined) => boolean,
 *   isWebPasswordEnabled: (p: string | undefined) => boolean,
 * }} */
let security = null;

function loadSecurity() {
  if (security) return security;
  const t0 = Date.now();
  const rs = jiti(path.join(root, "lib/request-security.ts"));
  const wa = jiti(path.join(root, "lib/web-auth.ts"));
  security = {
    isApiRequestAllowed: rs.isApiRequestAllowed,
    isApiRequestHostAllowed: rs.isApiRequestHostAllowed,
    isValidBasicAuthorization: wa.isValidBasicAuthorization,
    isWebPasswordEnabled: wa.isWebPasswordEnabled,
  };
  console.log(`[daemon] security helpers loaded in ${Date.now() - t0}ms`);
  return security;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<NextRequest>}
 */
async function toWebRequest(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const url = `http://${host}${req.url || "/"}`;
  const method = (req.method || "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  /** @type {RequestInit & { duplex?: string }} */
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new NextRequest(url, init);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Response} webRes
 */
async function sendWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(webRes.body);
  nodeStream.on("error", (err) => {
    console.error("[daemon] response stream error:", err);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  nodeStream.pipe(res);
}

/**
 * @param {string} pathname
 */
function contentTypeFor(pathname) {
  const ext = path.extname(pathname).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    case ".map":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 */
/**
 * Resolve a URL path under desktopDist without Windows path.join absolute-segment traps.
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveDesktopFile(pathname) {
  let rel = decodeURIComponent(pathname || "/");
  if (rel === "/" || rel === "") rel = "index.html";
  // Strip leading slashes so path.join/resolve never treats the segment as absolute.
  rel = rel.replace(/^[/\\]+/, "");
  const full = path.resolve(desktopDist, rel);
  const relToRoot = path.relative(desktopDist, full);
  if (
    relToRoot.startsWith("..") ||
    path.isAbsolute(relToRoot) ||
    relToRoot.includes(`..${path.sep}`)
  ) {
    return null;
  }
  return full;
}

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(desktopDist)) {
    res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Pi Web</title>
<body style="font-family:system-ui;padding:2rem;background:#111;color:#eee">
<h1>Desktop UI not built</h1>
<p>Run <code>npm run desktop:build</code> then restart.</p>
<p>Daemon is up (no Next.js). API: <a href="/api/health" style="color:#8cf">/api/health</a></p>
</body>`);
    return;
  }

  let filePath = resolveDesktopFile(pathname);
  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(desktopDist, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control":
      path.basename(filePath) === "index.html"
        ? "private, no-cache, max-age=0, must-revalidate"
        : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(res);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleApi(req, res) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const url = new URL(req.url || "/", `http://${host}`);

  // Inline health — never touch jiti/route modules.
  if (url.pathname === "/api/health") {
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end("ok");
    return;
  }

  const sec = loadSecurity();
  const webReq = await toWebRequest(req);

  if (!sec.isApiRequestAllowed(webReq)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Untrusted API request" }));
    return;
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (
    sec.isWebPasswordEnabled(password) &&
    !sec.isValidBasicAuthorization(webReq.headers.get("authorization"), password)
  ) {
    res.writeHead(401, {
      "cache-control": "no-store",
      "www-authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
    });
    res.end("Authentication required");
    return;
  }

  const matched = matchRoute(routes, url.pathname);
  if (!matched) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const { route, params } = matched;
  if (!route.mod) {
    const t0 = Date.now();
    route.mod = jiti(route.file);
    console.log(
      `[daemon] loaded ${path.relative(root, route.file)} in ${Date.now() - t0}ms`,
    );
  }

  const method = (req.method || "GET").toUpperCase();
  const handler = route.mod[method] || route.mod[method.toLowerCase()];
  if (typeof handler !== "function") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Method ${method} not allowed` }));
    return;
  }

  const ctx = { params: Promise.resolve(params) };
  const result = await handler(webReq, ctx);
  if (!result) {
    res.writeHead(204).end();
    return;
  }
  if (result instanceof Response) {
    await sendWebResponse(res, result);
    return;
  }
  res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Handler returned non-Response" }));
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const host = req.headers.host || `${HOST}:${PORT}`;
      const url = new URL(req.url || "/", `http://${host}`);

      if (!url.pathname.startsWith("/api")) {
        const sec = loadSecurity();
        const fakeReq = new Request(url.href, { headers: { host } });
        if (!sec.isApiRequestHostAllowed(fakeReq)) {
          res.writeHead(403).end("Untrusted request");
          return;
        }
        const password = process.env.PI_WEB_PASSWORD;
        if (
          sec.isWebPasswordEnabled(password) &&
          !sec.isValidBasicAuthorization(req.headers.authorization || null, password)
        ) {
          res.writeHead(401, {
            "cache-control": "no-store",
            "www-authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
          });
          res.end("Authentication required");
          return;
        }
        serveStatic(req, res, url.pathname);
        return;
      }

      await handleApi(req, res);
    } catch (err) {
      console.error("[daemon] request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } else {
        res.end();
      }
    }
  })();
});

server.listen(PORT, HOST, () => {
  const uiOk = fs.existsSync(path.join(desktopDist, "index.html"));
  console.log(
    `[daemon] listening on http://${HOST}:${PORT} (listen ${Date.now() - bootStarted}ms, routes=${routes.length}, runtime=daemon, no Next.js, ui=${uiOk ? "desktop-dist" : "MISSING"})`,
  );
  if (!uiOk) {
    console.warn(`[daemon] desktop UI missing at ${desktopDist} — run npm run desktop:build`);
  }
});

// Deferred boot — never blocks listen (mirrors instrumentation.ts intent).
const prewarmDelayMs = (() => {
  const raw = process.env.PI_WEB_PREWARM_DELAY_MS;
  if (raw == null || raw === "") return 2_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 2_000;
})();

const timer = setTimeout(() => {
  try {
    const { configureHttpDispatcher } = jiti(
      path.join(root, "lib/http-dispatcher.ts"),
    );
    try {
      const { readWebSettings } = jiti(path.join(root, "lib/web-settings.ts"));
      const prefs = readWebSettings();
      if (prefs.httpProxy) {
        process.env.HTTP_PROXY = prefs.httpProxy;
        process.env.HTTPS_PROXY = prefs.httpProxy;
      }
      if (prefs.proxyBypass) process.env.NO_PROXY = prefs.proxyBypass;
    } catch {
      // ignore
    }
    configureHttpDispatcher();

    const { ensureSubagentSpawnEnv } = jiti(
      path.join(root, "lib/resolve-pi-cli.ts"),
    );
    ensureSubagentSpawnEnv();

    const { ensureSubagentDelegation } = jiti(
      path.join(root, "lib/ensure-subagent-delegation.ts"),
    );
    for (const note of ensureSubagentDelegation()) {
      console.log(`[daemon] ${note}`);
    }

    void jiti(path.join(root, "lib/ensure-builtin-packages.ts"))
      .ensureBuiltinPackages()
      .then((r) => {
        for (const note of r.notes) console.log(`[daemon] ${note}`);
      })
      .catch((e) => console.error("[daemon] prewarm error:", e));
  } catch (e) {
    console.error("[daemon] deferred boot error:", e);
  }
}, prewarmDelayMs);
timer.unref?.();

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
