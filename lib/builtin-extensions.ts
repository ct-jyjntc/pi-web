/**
 * First-party agent capabilities shipped inside Pi Web (not via ~/.pi/agent/npm).
 *
 * Todo, ask-user, subagents, permission, and MCP are native factories.
 * Legacy settings.json packages[] entries are stripped on boot.
 */
import { pathToFileURL } from "url";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { getFirstPartyExtensionFactories } from "./first-party";

/** Names still stripped from settings.packages (retired npm packages). */
export const LEGACY_BUILTIN_PACKAGE_NAMES = [
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

/**
 * Resource-loader options for full agent sessions.
 * First-party factories own todo / ask-user / subagents / permission / MCP.
 */
export function getBuiltinResourceLoaderOptions(): {
  additionalExtensionPaths: string[];
  extensionFactories: InlineExtension[];
} {
  return {
    additionalExtensionPaths: [],
    extensionFactories: getFirstPartyExtensionFactories(),
  };
}

let prewarmPromise: Promise<{ loaded: string[]; missing: string[]; errors: string[] }> | null = null;

/**
 * Warm first-party factories through the SDK loader so the first session is cheaper.
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
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    return { loaded: [...new Set(loaded)], missing, errors };
  })();
  return prewarmPromise;
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
