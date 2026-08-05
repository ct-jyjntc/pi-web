#!/usr/bin/env node
/**
 * Transport-agnostic request dispatch for the agent runtime.
 *
 * Owns route discovery, the jiti loader and the deferred boot; takes a `Request`
 * and returns the handler's `Response`. Both the legacy HTTP server and the IPC
 * host are thin adapters over this, so moving the desktop client off HTTP does
 * not fork the handler contract.
 *
 * Handlers are unmodified `app/api/**` modules: `next/server` is shimmed to
 * plain `Request`/`Response` subclasses, so nothing here is Next-specific.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { discoverApiRoutes, matchRoute } from "./routes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

/** @type {import('./routes.mjs').RouteEntry[]} */
export const routes = discoverApiRoutes(root);

// ── jiti (created once; modules still lazy) ─────────────────────────────────
const { createJiti } = require("jiti");
const nextShim = path.join(__dirname, "shims", "next-server.mjs");

// Pin the transpile cache somewhere stable and always writable. jiti defaults to
// node_modules/.cache and falls back to the OS temp dir — in a packaged app the
// first is read-only under a per-machine install, and the second gets purged by
// Windows Storage Sense.
const agentDir =
  process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
const jitiCacheDir = path.join(agentDir, "cache", "jiti");
try {
  fs.mkdirSync(jitiCacheDir, { recursive: true });
} catch {
  // Fall back to jiti's own default rather than failing boot.
}

export const jiti = createJiti(import.meta.url, {
  fsCache: jitiCacheDir,
  interopDefault: true,
  alias: {
    "@": root,
    "next/server": nextShim,
  },
});

/**
 * Resolve a lib module to whatever this tree actually ships. The dev tree has
 * TypeScript; packaged trees ship precompiled ESM (see prepare-electron-standalone).
 * @param {string} name lib module name without extension, e.g. "http-dispatcher"
 */
export function libModule(name) {
  for (const ext of [".mjs", ".js", ".ts"]) {
    const candidate = path.join(root, "lib", name + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`runtime: lib/${name} missing from ${root}`);
}

/**
 * Match a URL to a handler and run it.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function dispatch(request) {
  const url = new URL(request.url);

  const matched = matchRoute(routes, url.pathname);
  if (!matched) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { route, params } = matched;
  if (!route.mod) {
    const t0 = Date.now();
    route.mod = jiti(route.file);
    console.log(`[runtime:${process.env.PI_WEB_RUNTIME_ROLE || "heavy"}] loaded ${path.relative(root, route.file)} in ${Date.now() - t0}ms`);
  }

  const method = request.method.toUpperCase();
  const handler = route.mod[method] || route.mod[method.toLowerCase()];
  if (typeof handler !== "function") {
    return Response.json({ error: `Method ${method} not allowed` }, { status: 405 });
  }

  const result = await handler(request, { params: Promise.resolve(params) });
  if (!result) return new Response(null, { status: 204 });
  if (result instanceof Response) return result;
  return Response.json({ error: "Handler returned non-Response" }, { status: 500 });
}

// ── Deferred boot ───────────────────────────────────────────────────────────
//
// `prewarmDelayMs` is how long the client must stay quiet, not a fixed delay:
// prewarming the builtin extensions is seconds of synchronous module loading,
// and the runtime cannot serve anything while it runs. Callers report activity
// through `noteClientActivity()`. If the client never goes quiet the extensions
// still load lazily on first session start, so there is no fallback to add.
const prewarmDelayMs = (() => {
  const raw = process.env.PI_WEB_PREWARM_DELAY_MS;
  if (raw == null || raw === "") return 2_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 2_000;
})();

let lastClientActivityAt = Date.now();

/** Push the prewarm back — the client is still waiting on us. */
export function noteClientActivity() {
  lastClientActivityAt = Date.now();
}

function runDeferredBoot() {
  try {
    const { configureHttpDispatcher } = jiti(libModule("http-dispatcher"));
    try {
      const { readWebSettings } = jiti(libModule("web-settings"));
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

    const { ensureSubagentSpawnEnv } = jiti(libModule("resolve-pi-cli"));
    ensureSubagentSpawnEnv();

    const { ensureSubagentDelegation } = jiti(libModule("ensure-subagent-delegation"));
    for (const note of ensureSubagentDelegation()) {
      console.log(`[runtime] ${note}`);
    }

    void jiti(libModule("ensure-builtin-packages"))
      .ensureBuiltinPackages()
      .then((r) => {
        for (const note of r.notes) console.log(`[runtime] ${note}`);
      })
      .catch((e) => console.error("[runtime] prewarm error:", e));
  } catch (e) {
    console.error("[runtime] deferred boot error:", e);
  }
}

export function scheduleDeferredBoot() {
  const quietFor = Date.now() - lastClientActivityAt;
  if (quietFor < prewarmDelayMs) {
    setTimeout(scheduleDeferredBoot, prewarmDelayMs - quietFor).unref?.();
    return;
  }
  runDeferredBoot();
}
