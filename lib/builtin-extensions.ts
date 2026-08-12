/**
 * First-party agent capabilities shipped inside Pi Web (not via ~/.pi/agent/npm).
 *
 * Todo, ask-user, subagents, permission, and MCP are native first-party modules.
 * Legacy settings.json packages[] entries are stripped on boot.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { getFirstPartyExtensionFactories } from "./first-party";
import {
  HEAVY_EXTENSION_SPECS,
  loadHeavyExtensionFactories,
  resolveHeavyBundlePath,
  type HeavyLoadResult,
} from "./first-party/heavy-extensions";
import { resolveNpmPackageRoot } from "./resolve-npm-package-root";

/**
 * Heavy packages shipped as app dependencies.
 * Prefer prebundled factories; TS entry paths are fallback only.
 */
export const BUILTIN_EXTENSION_PACKAGES = HEAVY_EXTENSION_SPECS.map((s) => s.packageName);

export type BuiltinExtensionPackage = (typeof BUILTIN_EXTENSION_PACKAGES)[number];

/** Names still stripped from settings.packages (includes retired thin packages). */
export const LEGACY_BUILTIN_PACKAGE_NAMES = [
  ...BUILTIN_EXTENSION_PACKAGES,
  "@gotgenes/pi-permission-system",
  "@gotgenes/pi-subagents",
  "pi-mcp-adapter",
  "@juicesharp/rpiv-ask-user-question",
  "@juicesharp/rpiv-todo",
  "@lll9p/pi-better-compaction",
] as const;

/** Legacy settings.json / package-manager source strings for the same packages. */
export const BUILTIN_PACKAGE_SOURCES = LEGACY_BUILTIN_PACKAGE_NAMES.map(
  (name) => `npm:${name}` as const,
);

/** Previously auto-installed TUI-only packages we still want to strip if present. */
export const PRUNE_PACKAGE_SOURCES = [
  "npm:pi-btw",
  "npm:pi-markdown-preview",
  "npm:pi-simplify",
  "npm:pi-tool-display",
  "npm:pi-rtk-optimizer",
] as const;

export type BuiltinExtensionPath = {
  packageName: string;
  path: string;
};

function readPiExtensionEntries(packageRoot: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      pi?: { extensions?: string[] };
    };
    const entries = pkg.pi?.extensions;
    if (!Array.isArray(entries) || entries.length === 0) return [];
    return entries
      .map((rel) => join(packageRoot, rel))
      .filter((abs) => existsSync(abs));
  } catch {
    return [];
  }
}

/**
 * TS entry paths for packages that do NOT yet have a prebundle (fallback).
 */
export function resolveBuiltinExtensionPaths(options?: {
  /** Only packages listed here (defaults to those without a heavy bundle). */
  onlyMissingBundles?: boolean;
}): BuiltinExtensionPath[] {
  const onlyMissing = options?.onlyMissingBundles !== false;
  const out: BuiltinExtensionPath[] = [];
  for (const packageName of BUILTIN_EXTENSION_PACKAGES) {
    if (onlyMissing && resolveHeavyBundlePath(packageName)) continue;
    const root = resolveNpmPackageRoot(packageName);
    if (!root) continue;
    for (const path of readPiExtensionEntries(root)) {
      out.push({ packageName, path });
    }
  }
  return out;
}

/** Packaged TS fallbacks are retired — permission/MCP/subagents are native. */
export function getBuiltinAdditionalExtensionPaths(): string[] {
  return [];
}

let heavyCache: HeavyLoadResult | null = null;
let heavyPromise: Promise<HeavyLoadResult> | null = null;

/** Ensure heavy prebundled factories are imported (once per process). */
export async function ensureHeavyExtensionFactories(): Promise<HeavyLoadResult> {
  if (heavyCache) return heavyCache;
  if (!heavyPromise) {
    heavyPromise = loadHeavyExtensionFactories().then((r) => {
      heavyCache = r;
      return r;
    });
  }
  return heavyPromise;
}

/**
 * Resource-loader options for full agent sessions.
 * First-party factories own todo / ask-user / subagents / permission / MCP.
 * TS paths remain only for packaged factories whose bundle is missing.
 */
export function getBuiltinResourceLoaderOptions(): {
  additionalExtensionPaths: string[];
  extensionFactories: InlineExtension[];
} {
  return {
    additionalExtensionPaths: getBuiltinAdditionalExtensionPaths(),
    extensionFactories: getFirstPartyExtensionFactories(),
  };
}

let prewarmPromise: Promise<{ loaded: string[]; missing: string[]; errors: string[] }> | null = null;

/**
 * Preload heavy factories + warm any remaining TS fallbacks via the SDK loader.
 * Never throws.
 */
export function prewarmBuiltinExtensions(): Promise<{
  loaded: string[];
  missing: string[];
  errors: string[];
}> {
  if (prewarmPromise) return prewarmPromise;
  prewarmPromise = (async () => {
    const loaded: string[] = [];
    const missing: string[] = [];
    const errors: string[] = [];

    try {
      // Best-effort: generate missing bundles before import (dev / first boot).
      await tryBundleHeavyExtensions();

      const heavy = await ensureHeavyExtensionFactories();
      for (const n of heavy.notes) {
        // surface as loaded/missing via structured fields
      }
      for (const f of heavy.factories) {
        if (typeof f !== "function") loaded.push(`<inline:${f.name}>`);
      }
      missing.push(...heavy.missing);
      for (const n of heavy.notes) {
        if (n.includes("failed") || n.includes("missing")) errors.push(n);
      }

      const fallbackPaths = getBuiltinAdditionalExtensionPaths();
      if (fallbackPaths.length === 0 && heavy.factories.length > 0) {
        // Full prebundle path — optional cheap factory-only reload for SDK cache.
        const { DefaultResourceLoader, getAgentDir, SettingsManager } = await import(
          "@earendil-works/pi-coding-agent"
        );
        const cwd = process.cwd();
        const agentDir = getAgentDir();
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager: SettingsManager.create(cwd, agentDir),
          extensionFactories: getBuiltinResourceLoaderOptions().extensionFactories,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        });
        await loader.reload();
        const result = loader.getExtensions();
        for (const ext of result.extensions) loaded.push(ext.path);
        for (const err of result.errors) errors.push(`${err.path}: ${err.error}`);
        return { loaded: [...new Set(loaded)], missing, errors };
      }

      // Mixed / fallback: include TS paths for any unbundled packages.
      const { DefaultResourceLoader, getAgentDir, SettingsManager } = await import(
        "@earendil-works/pi-coding-agent"
      );
      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const opts = getBuiltinResourceLoaderOptions();
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: SettingsManager.create(cwd, agentDir),
        additionalExtensionPaths: opts.additionalExtensionPaths,
        extensionFactories: opts.extensionFactories,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      const result = loader.getExtensions();
      for (const ext of result.extensions) loaded.push(ext.path);
      for (const err of result.errors) errors.push(`${err.path}: ${err.error}`);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    return { loaded: [...new Set(loaded)], missing, errors };
  })();
  return prewarmPromise;
}

/** Best-effort run of the esbuild bundle script (no throw). */
async function tryBundleHeavyExtensions(): Promise<void> {
  const needsBundle = HEAVY_EXTENSION_SPECS.some((s) => !resolveHeavyBundlePath(s.packageName));
  if (!needsBundle) return;
  try {
    const { spawnSync } = await import("child_process");
    const script = join(process.cwd(), "scripts", "bundle-builtin-extensions.mjs");
    if (!existsSync(script)) {
      console.warn("[pi-web] bundle script missing:", script);
      return;
    }
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.stdout) console.log(result.stdout.trimEnd());
    if (result.status !== 0) {
      console.warn("[pi-web] auto-bundle heavy extensions failed:", (result.stderr || result.stdout || "").trim());
      return;
    }
    // Allow re-import of newly written bundles.
    const { invalidateHeavyExtensionFactories } = await import("./first-party/heavy-extensions");
    invalidateHeavyExtensionFactories();
    heavyCache = null;
    heavyPromise = null;
  } catch (e) {
    console.warn(
      "[pi-web] auto-bundle heavy extensions failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** True when a settings/package source string refers to a first-party / retired builtin. */
export function isBuiltinPackageSource(source: string): boolean {
  const s = source.trim();
  if (!s) return false;
  for (const name of LEGACY_BUILTIN_PACKAGE_NAMES) {
    if (s === name || s === `npm:${name}` || s.startsWith(`npm:${name}@`)) {
      return true;
    }
  }
  return BUILTIN_PACKAGE_SOURCES.includes(s as (typeof BUILTIN_PACKAGE_SOURCES)[number]);
}

/** file URL helper for diagnostics */
export function builtinExtensionFileUrl(absPath: string): string {
  return pathToFileURL(absPath).href;
}
