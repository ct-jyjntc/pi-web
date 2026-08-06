/**
 * Rewrite or remove absolute / out-of-bundle symlinks under a packaged tree.
 * Node's cpSync may materialize npm .bin links as absolute paths pointing at
 * the host node_modules — codesign --deep --strict then fails with
 * "invalid destination for symbolic link in bundle".
 */
import { lstatSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      out.push(full);
      continue;
    }
    if (ent.isDirectory()) walk(full, out);
  }
  return out;
}

/**
 * @param {string} root absolute path of the bundle subtree to sanitize
 * @param {{ label?: string }} [opts]
 * @returns {{ rewrote: number, removed: number, ok: number }}
 */
export function sanitizeBundleSymlinks(root, opts = {}) {
  const label = opts.label || root;
  const rootAbs = resolve(root);
  let rewrote = 0;
  let removed = 0;
  let ok = 0;

  for (const link of walk(rootAbs)) {
    let target;
    try {
      target = readlinkSync(link);
    } catch {
      continue;
    }

    const resolved = isAbsolute(target) ? target : resolve(dirname(link), target);
    const inside =
      resolved === rootAbs ||
      resolved.startsWith(rootAbs + sep);

    // Relative link that still resolves inside the tree — keep.
    if (!isAbsolute(target) && inside) {
      ok += 1;
      continue;
    }

    // Absolute but points inside the tree — rewrite to relative.
    if (isAbsolute(target) && inside) {
      const rel = relative(dirname(link), resolved);
      try {
        unlinkSync(link);
        symlinkSync(rel, link);
        rewrote += 1;
      } catch (e) {
        console.warn(`[sanitize-symlinks] rewrite failed ${link}:`, e);
        try {
          unlinkSync(link);
          removed += 1;
        } catch {
          /* ignore */
        }
      }
      continue;
    }

    // Outside the bundle (or broken absolute) — remove; .bin stubs are optional at runtime.
    try {
      unlinkSync(link);
      removed += 1;
      console.warn(`[sanitize-symlinks] removed out-of-bundle link: ${link} -> ${target}`);
    } catch (e) {
      console.warn(`[sanitize-symlinks] remove failed ${link}:`, e);
    }
  }

  console.log(
    `[sanitize-symlinks] ${label}: rewrote ${rewrote}, removed ${removed}, kept ${ok}`,
  );
  return { rewrote, removed, ok };
}

// CLI: node scripts/sanitize-bundle-symlinks.mjs <dir>
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sanitize-bundle-symlinks.mjs")) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/sanitize-bundle-symlinks.mjs <dir>");
    process.exit(2);
  }
  sanitizeBundleSymlinks(dir);
}
