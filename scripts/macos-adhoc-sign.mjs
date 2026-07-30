#!/usr/bin/env node
/**
 * macOS ad-hoc codesign helpers.
 *
 * Electron 42+ uses UNNotification, which rejects:
 *   - unsigned binaries
 *   - linker-signed adhoc (flags=0x20002) shipped with Electron.app
 * Real ad-hoc (`codesign --sign -`, flags=0x2) is enough for local notifications.
 *
 * Packaged builds: prefer electron-builder `mac.identity: "-"` (uses @electron/osx-sign).
 * Dev Electron.app: this helper re-signs without `--deep` (deep fails on Electron Framework).
 *
 * Not a substitute for Developer ID + notarization when distributing.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

/**
 * @param {string} target path to .app or binary
 * @returns {{ ok: boolean, output: string }}
 */
export function inspectSignature(target) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", target], {
    encoding: "utf8",
  });
  const output = `${result.stderr || ""}${result.stdout || ""}`;
  return { ok: result.status === 0, output };
}

/**
 * @param {string} output codesign -dv text
 * @returns {{ signed: boolean, adhoc: boolean, linkerSigned: boolean, flags: string | null }}
 */
export function parseSignature(output) {
  const flagsMatch = output.match(/flags=(0x[0-9a-fA-F]+(?:\([^)]*\))?)/);
  const flags = flagsMatch ? flagsMatch[1] : null;
  const linkerSigned = /linker-signed/i.test(output) || /flags=0x20002/i.test(output);
  const adhoc =
    /Signature=adhoc/i.test(output) ||
    /\(adhoc\)/i.test(output) ||
    /flags=0x2\b/i.test(output);
  const signed = resultLooksSigned(output);
  return { signed, adhoc, linkerSigned, flags };
}

function resultLooksSigned(output) {
  if (/code object is not signed at all/i.test(output)) return false;
  if (/No such file/i.test(output)) return false;
  return /Signature=|Authority=|flags=/i.test(output);
}

/**
 * True when the target will fail Electron 42+ UNNotification checks.
 * @param {string} target
 */
export function needsAdhocResign(target) {
  if (!existsSync(target)) return true;
  const { ok, output } = inspectSignature(target);
  if (!ok && /not signed/i.test(output)) return true;
  const info = parseSignature(output);
  if (info.linkerSigned) return true;
  if (!info.signed) return true;
  // Real ad-hoc without linker-signed is good enough for local notifications.
  if (info.adhoc && !info.linkerSigned) return false;
  // Developer ID / other identities are also fine — leave them alone.
  if (/Authority=/i.test(output) && !info.linkerSigned) return false;
  return true;
}

function runCodesign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  const output = `${result.stderr || ""}${result.stdout || ""}`;
  if (result.status !== 0) {
    throw new Error(`codesign ${args.join(" ")} failed:\n${output}`);
  }
  return output;
}

/**
 * Resolve Contents/MacOS/<executable> for an .app bundle.
 * @param {string} appPath
 * @returns {string | null}
 */
function resolveAppExecutable(appPath) {
  const macOSDir = join(appPath, "Contents", "MacOS");
  if (!existsSync(macOSDir)) return null;

  const plist = join(appPath, "Contents", "Info.plist");
  if (existsSync(plist)) {
    try {
      const text = readFileSync(plist, "utf8");
      const match = text.match(
        /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/,
      );
      if (match?.[1]) {
        const execPath = join(macOSDir, match[1]);
        if (existsSync(execPath)) return execPath;
      }
    } catch {
      // fall through
    }
  }

  try {
    const entries = readdirSync(macOSDir).filter((n) => !n.startsWith("."));
    if (entries.length === 1) return join(macOSDir, entries[0]);
    // Prefer non-helper names
    const preferred = entries.find((n) => !/helper/i.test(n));
    if (preferred) return join(macOSDir, preferred);
    if (entries[0]) return join(macOSDir, entries[0]);
  } catch {
    // ignore
  }
  return null;
}

/**
 * Ad-hoc sign a macOS .app or binary.
 * Avoids `--deep` (breaks on Electron Framework subcomponents).
 * @param {string} target
 * @param {{ force?: boolean, label?: string }} [opts]
 * @returns {{ skipped: boolean, output: string }}
 */
export function adhocSign(target, opts = {}) {
  const force = opts.force === true;
  const label = opts.label || target;

  if (!existsSync(target)) {
    throw new Error(`[adhoc-sign] missing target: ${target}`);
  }

  if (!force && !needsAdhocResign(target)) {
    const { output } = inspectSignature(target);
    const info = parseSignature(output);
    console.log(
      `[adhoc-sign] skip ${label} (already ok${info.flags ? `, flags=${info.flags}` : ""})`,
    );
    return { skipped: true, output };
  }

  console.log(`[adhoc-sign] signing ${label} (ad-hoc, no --deep)`);

  if (target.endsWith(".app")) {
    const execPath = resolveAppExecutable(target);
    if (execPath) {
      // Sign the main binary first, then the bundle seal.
      runCodesign(["--force", "--sign", "-", execPath]);
    }
    runCodesign(["--force", "--sign", "-", target]);
  } else {
    runCodesign(["--force", "--sign", "-", target]);
  }

  const check = inspectSignature(target);
  const info = parseSignature(check.output);
  if (info.linkerSigned) {
    throw new Error(
      `[adhoc-sign] still linker-signed after resign: ${label}\n${check.output}`,
    );
  }
  if (!info.adhoc && !/Authority=/i.test(check.output)) {
    throw new Error(
      `[adhoc-sign] signature missing after resign: ${label}\n${check.output}`,
    );
  }
  console.log(
    `[adhoc-sign] ok ${label}${info.flags ? ` (flags=${info.flags})` : ""}`,
  );
  return { skipped: false, output: check.output };
}

// CLI: node scripts/macos-adhoc-sign.mjs <path> [--force]
const isCli =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const args = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");
  const target = args[0];
  if (!target) {
    console.error("Usage: node scripts/macos-adhoc-sign.mjs <path-to.app> [--force]");
    process.exit(1);
  }
  try {
    adhocSign(target, { force });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
