/**
 * Packaged coding-agent entry: register static OAuth loaders, then re-export
 * the real SDK index. esbuild starts here so both land in one module graph and
 * share load.js's `bundledLoaders` slot.
 *
 * Relative path (not package export) so esbuild resolves the real dist/index.js.
 */
import "./register-bundled-oauth.mjs";
export * from "../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
