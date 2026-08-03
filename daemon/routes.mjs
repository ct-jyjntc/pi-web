/**
 * Discover App Router handlers under app/api (route.ts files) and match URLs.
 * Modules are loaded lazily on first hit (jiti) so listen stays cheap.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {{
 *   file: string,
 *   regex: RegExp,
 *   paramNames: string[],
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
   * @param {string} dir
   * @param {string[]} segments
   */
  function walk(dir, segments) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full, [...segments, name]);
        continue;
      }
      if (name !== "route.ts" && name !== "route.js") continue;

      /** @type {string[]} */
      const paramNames = [];
      /** @type {string[]} */
      const regexParts = ["api"];
      let dynamics = 0;
      let catchAll = 0;

      for (const seg of segments) {
        if (seg.startsWith("[[...") && seg.endsWith("]]")) {
          const n = seg.slice(5, -2);
          paramNames.push(n);
          regexParts.push(`(?<${n}>.*)`);
          catchAll += 1;
          dynamics += 1;
        } else if (seg.startsWith("[...") && seg.endsWith("]")) {
          const n = seg.slice(4, -1);
          paramNames.push(n);
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
        score,
      });
    }
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
 * @param {RouteEntry[]} routes
 * @param {string} pathname
 * @returns {{ route: RouteEntry, params: Record<string, string> } | null}
 */
export function matchRoute(routes, pathname) {
  const pathOnly = pathname.split("?")[0] || pathname;
  for (const route of routes) {
    const m = pathOnly.match(route.regex);
    if (!m) continue;
    /** @type {Record<string, string>} */
    const params = {};
    if (m.groups) {
      for (const [k, v] of Object.entries(m.groups)) {
        if (v != null) params[k] = v;
      }
    }
    return { route, params };
  }
  return null;
}
