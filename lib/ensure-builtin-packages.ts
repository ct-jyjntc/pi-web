/**
 * Migrate away from ~/.pi/agent npm-installed "builtin packages".
 *
 * First-party capabilities now ship as app dependencies and are registered via
 * lib/builtin-extensions.ts (additionalExtensionPaths). This module only:
 *   1. Strips those package sources from settings.json so the package manager
 *      does not double-load or try to update them
 *   2. Optionally prunes legacy TUI-only package entries from settings
 *   3. Prewarms the SDK extension cache so the first session is cheaper
 *
 * It never runs `npm install` / `npm update` and never blocks app startup.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./agent-dir";
import {
  BUILTIN_PACKAGE_SOURCES,
  PRUNE_PACKAGE_SOURCES,
  isBuiltinPackageSource,
  prewarmBuiltinExtensions,
  resolveBuiltinExtensionPaths,
} from "./builtin-extensions";

let ensurePromise: Promise<{ notes: string[]; loaded: string[]; missing: string[] }> | null = null;

function packageSourceString(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "source" in entry) {
    const s = (entry as { source?: unknown }).source;
    return typeof s === "string" ? s : null;
  }
  return null;
}

function shouldStripSource(source: string): boolean {
  if (isBuiltinPackageSource(source)) return true;
  for (const prune of PRUNE_PACKAGE_SOURCES) {
    const bare = prune.startsWith("npm:") ? prune.slice(4) : prune;
    if (
      source === prune
      || source === bare
      || source.startsWith(`${prune}@`)
      || source.startsWith(`npm:${bare}@`)
      || source.startsWith(`${bare}@`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Synchronous settings.json rewrite — drop migrated first-party package entries.
 * Call at module load (before any session) so the package manager never double-loads.
 */
export function migrateBuiltinPackageSettings(): string[] {
  const notes: string[] = [];
  try {
    const settingsPath = join(getAgentDir(), "settings.json");
    if (!existsSync(settingsPath)) return notes;
    const raw = readFileSync(settingsPath, "utf8");
    const data = JSON.parse(raw) as { packages?: unknown[]; [k: string]: unknown };
    if (!Array.isArray(data.packages) || data.packages.length === 0) return notes;

    const removed: string[] = [];
    const next = data.packages.filter((entry) => {
      const source = packageSourceString(entry);
      if (source && shouldStripSource(source)) {
        removed.push(source);
        return false;
      }
      return true;
    });
    if (removed.length === 0) return notes;

    data.packages = next;
    writeFileSync(settingsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    notes.push(`Rewrote settings.json packages (−${removed.length}): ${removed.join(", ")}`);
  } catch (e) {
    notes.push(`settings.json rewrite failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return notes;
}

/**
 * One-shot migration + prewarm. Safe to call with void from instrumentation.
 * Never throws out of the returned promise in a way that crashes the process.
 */
export function ensureBuiltinPackages(): Promise<{
  notes: string[];
  loaded: string[];
  missing: string[];
}> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const notes: string[] = [];
    let loaded: string[] = [];
    let missing: string[] = [];

    try {
      notes.push(...migrateBuiltinPackageSettings());

      const resolved = resolveBuiltinExtensionPaths();
      notes.push(
        resolved.length > 0
          ? `Builtin extensions resolved from app install: ${resolved.map((r) => r.packageName).join(", ")}`
          : "WARNING: no builtin extensions resolved from app node_modules",
      );

      const warm = await prewarmBuiltinExtensions();
      loaded = warm.loaded;
      missing = warm.missing;
      for (const err of warm.errors) notes.push(`Prewarm: ${err}`);
      if (warm.loaded.length) notes.push(`Prewarmed ${warm.loaded.length} builtin extension(s)`);
      if (warm.missing.length) notes.push(`Missing builtin packages: ${warm.missing.join(", ")}`);

      // Keep the source list referenced so re-exports stay live for docs/callers.
      void BUILTIN_PACKAGE_SOURCES;
    } catch (error) {
      notes.push(`ensureBuiltinPackages failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error("[pi-web]", notes[notes.length - 1]);
    }

    return { notes, loaded, missing };
  })();
  return ensurePromise;
}

// Re-export names that older imports / docs may still reference.
export { BUILTIN_PACKAGE_SOURCES, PRUNE_PACKAGE_SOURCES } from "./builtin-extensions";
