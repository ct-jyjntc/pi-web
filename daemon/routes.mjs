/**
 * Discover App Router handlers under app/api (route.ts / route.mjs) and match URLs.
 * Modules are loaded lazily on first hit (jiti) so listen stays cheap.
 *
 * Param shape matches Next.js App Router:
 *   [id]      → string
 *   [...path] → string[]   (critical for files route segments.join)
 *   [[...x]]  → string[] | undefined
 */
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {{
 *   file: string,
 *   regex: RegExp,
 *   paramNames: string[],
 *   catchAllParams: Set<string>,
 *   optionalCatchAllParams: Set<string>,
 *   score: number,
 *   mod?: Record<string, unknown>,
 * }} RouteEntry
 */

/**
 * @param {string} root
 * @returns {RouteEntry[]}
 */
export function discoverApiRoutes(root) {
  const apiRoot = path.join(root, "app", "api");
  /** @type {RouteEntry[]} */
  const routes = [];

  /**
   * One route module per directory. The dev tree has TypeScript; packaged trees
   * ship precompiled ESM instead (jiti transpiling `.ts` at runtime cost ~25s on
   * a cold Windows install). Ordering only settles a stale-artifact tie.
   */
  const ROUTE_FILENAMES = ["route.mjs", "route.js", "route.ts"];

  /**
   * @param {string} dir
   * @param {string[]} segments
   */
  function walk(dir, segments) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, [...segments, name]);
    }

    const routeName = ROUTE_FILENAMES.find((n) => fs.existsSync(path.join(dir, n)));
    if (!routeName) return;
    const full = path.join(dir, routeName);

    /** @type {string[]} */
    const paramNames = [];
    /** @type {Set<string>} */
    const catchAllParams = new Set();
    /** @type {Set<string>} */
    const optionalCatchAllParams = new Set();
    /** @type {string[]} */
    const regexParts = ["api"];
    let dynamics = 0;
    let catchAll = 0;

    for (const seg of segments) {
      if (seg.startsWith("[[...") && seg.endsWith("]]")) {
        const n = seg.slice(5, -2);
        paramNames.push(n);
        optionalCatchAllParams.add(n);
        catchAllParams.add(n);
        regexParts.push(`(?<${n}>.*)`);
        catchAll += 1;
        dynamics += 1;
      } else if (seg.startsWith("[...") && seg.endsWith("]")) {
        const n = seg.slice(4, -1);
        paramNames.push(n);
        catchAllParams.add(n);
        regexParts.push(`(?<${n}>.+)`);
        catchAll += 1;
        dynamics += 1;
      } else if (seg.startsWith("[") && seg.endsWith("]")) {
        const n = seg.slice(1, -1);
        paramNames.push(n);
        regexParts.push(`(?<${n}>[^/]+)`);
        dynamics += 1;
      } else {
        regexParts.push(escapeRegExp(seg));
      }
    }

    const pattern = `^/${regexParts.join("/")}/?$`;
    // Prefer static, then deeper, then non-catch-all.
    const score = segments.length * 100 - dynamics * 10 - catchAll * 50;

    routes.push({
      file: full,
      regex: new RegExp(pattern),
      paramNames,
      catchAllParams,
      optionalCatchAllParams,
      score,
    });
  }

  walk(apiRoot, []);
  routes.sort((a, b) => b.score - a.score);
  return routes;
}

/**
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decode one path segment. Node's URL.pathname keeps %XX (e.g. C%3A for "C:"),
 * while Next.js hands handlers decoded params. Must decode per-segment so that
 * %2F inside a single segment cannot introduce extra path separators.
 * @param {string} segment
 */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function splitCatchAll(raw) {
  if (raw == null || raw === "") return [];
  // URL path segments — Windows drive: "C%3A/Users/foo" or "C:/Users/foo"
  // → ["C:", "Users", "foo"] after per-segment decode.
  return raw.split("/").filter((part, i, arr) => {
    if (part === "" && (i === 0 || i === arr.length - 1)) return false;
    return true;
  }).map(decodeSegment);
}

/**
 * @param {RouteEntry[]} routes
 * @param {string} pathname
 * @returns {{ route: RouteEntry, params: Record<string, string | string[]> } | null}
 */
export function matchRoute(routes, pathname) {
  const pathOnly = pathname.split("?")[0] || pathname;
  for (const route of routes) {
    const m = pathOnly.match(route.regex);
    if (!m) continue;
    /** @type {Record<string, string | string[]>} */
    const params = {};
    if (m.groups) {
      for (const [k, v] of Object.entries(m.groups)) {
        if (v == null) continue;
        if (route.catchAllParams.has(k)) {
          const parts = splitCatchAll(v);
          if (parts.length === 0 && route.optionalCatchAllParams.has(k)) {
            // optional catch-all with no segments → omit (Next uses undefined)
            continue;
          }
          params[k] = parts;
        } else {
          params[k] = decodeSegment(v);
        }
      }
    }
    // Ensure required catch-alls always present as array
    for (const name of route.catchAllParams) {
      if (params[name] == null && !route.optionalCatchAllParams.has(name)) {
        params[name] = [];
      }
    }
    return { route, params };
  }
  return null;
}
