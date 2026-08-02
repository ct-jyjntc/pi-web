/**
 * Resolve an installed npm package root without dynamic require.resolve().
 * Turbopack cannot analyze require.resolve(`${name}/package.json`) and emits
 * "Can't resolve <dynamic>" warnings; path walking is enough for app deps.
 */
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

/**
 * Return absolute package root (directory containing package.json whose name matches),
 * or null if not found under common node_modules locations.
 */
export function resolveNpmPackageRoot(packageName: string, fromUrl = import.meta.url): string | null {
  const parts = packageName.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const candidates: string[] = [join(process.cwd(), "node_modules", ...parts)];

  // Walk up from the calling module (and this helper) looking for node_modules/<pkg>.
  for (const start of [fromUrl, import.meta.url]) {
    let dir = dirname(fileURLToPath(start));
    for (let i = 0; i < 12; i++) {
      candidates.push(join(dir, "node_modules", ...parts));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Node's module search path list (no package export resolution).
  try {
    for (const base of require.resolve.paths(packageName) ?? []) {
      candidates.push(join(base, ...parts));
    }
  } catch {
    // ignore
  }

  const seen = new Set<string>();
  for (const root of candidates) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const pkgJson = join(root, "package.json");
    if (!existsSync(pkgJson)) continue;
    try {
      const name = (JSON.parse(readFileSync(pkgJson, "utf8")) as { name?: string }).name;
      if (name === packageName) return root;
    } catch {
      // ignore malformed
    }
  }
  return null;
}
