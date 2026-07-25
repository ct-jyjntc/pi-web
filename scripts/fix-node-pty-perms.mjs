#!/usr/bin/env node
/**
 * Ensure node-pty spawn-helper binaries are executable.
 * Some npm/packaging paths strip the +x bit and PTY spawn then fails with
 * "posix_spawnp failed".
 */
import { chmodSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const root = join(process.cwd(), "node_modules", "node-pty");
if (!existsSync(root)) process.exit(0);

function walk(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.name === "spawn-helper") {
      try {
        const mode = statSync(full).mode;
        if ((mode & 0o111) !== 0o111) {
          chmodSync(full, mode | 0o755);
          console.log(`[fix-node-pty-perms] chmod +x ${full}`);
        }
      } catch (error) {
        console.warn(`[fix-node-pty-perms] failed for ${full}:`, error);
      }
    }
  }
}

walk(root);
