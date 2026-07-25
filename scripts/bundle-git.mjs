#!/usr/bin/env node
/**
 * Bundle a portable Git distribution (desktop/dugite-native) into the Electron
 * standalone tree so end users do not need a system Git install.
 *
 * Output: .next/standalone/git/  (bin/git, libexec/, share/, etc.)
 */
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import { spawnSync } from "child_process";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const outDir = join(standalone, "git");

// Pin a known-good dugite-native release (GitHub Desktop's portable Git).
const DUGITE_TAG = "v2.53.0-3";
const DUGITE_REV = "f49d009";

if (!existsSync(join(standalone, "server.js"))) {
  console.error("Missing standalone server — run next build first.");
  process.exit(1);
}

function platformAsset() {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  if (process.platform === "darwin") {
    return {
      name: `dugite-native-v2.53.0-${DUGITE_REV}-macOS-${arch}.tar.gz`,
      label: `macOS-${arch}`,
    };
  }
  if (process.platform === "win32") {
    return {
      name: `dugite-native-v2.53.0-${DUGITE_REV}-windows-${arch}.tar.gz`,
      label: `windows-${arch}`,
    };
  }
  // Linux
  return {
    name: `dugite-native-v2.53.0-${DUGITE_REV}-ubuntu-${arch}.tar.gz`,
    label: `ubuntu-${arch}`,
  };
}

function cacheDir() {
  return process.env.PI_WEB_GIT_CACHE || join(homedir(), ".cache", "pi-web-git");
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log(`Using cached ${dest}`);
    return;
  }
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);
  const tmp = `${dest}.partial`;
  await pipeline(res.body, createWriteStream(tmp));
  const { renameSync } = await import("fs");
  renameSync(tmp, dest);
}

function chmodTree(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodTree(full);
      continue;
    }
    // Executables in bin/ and libexec/
    if (full.includes(`${join("bin")}`) || full.includes("libexec") || !entry.name.includes(".")) {
      try {
        chmodSync(full, 0o755);
      } catch {
        // ignore
      }
    }
  }
}

async function main() {
  const asset = platformAsset();
  const url = `https://github.com/desktop/dugite-native/releases/download/${DUGITE_TAG}/${asset.name}`;
  const archive = join(cacheDir(), asset.name);
  await download(url, archive);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const tar = spawnSync("tar", ["-xzf", archive, "-C", outDir], { encoding: "utf8" });
  if (tar.status !== 0) {
    console.error(tar.stderr || "tar extract failed");
    process.exit(1);
  }

  const gitBin = join(outDir, "bin", process.platform === "win32" ? "git.exe" : "git");
  if (!existsSync(gitBin)) {
    console.error(`git binary missing after extract: ${gitBin}`);
    process.exit(1);
  }
  chmodTree(join(outDir, "bin"));
  chmodTree(join(outDir, "libexec"));

  const ver = spawnSync(gitBin, ["--version"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_EXEC_PATH: join(outDir, "libexec", "git-core"),
      PATH: `${join(outDir, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
    },
  });
  if (ver.status !== 0) {
    console.error("Bundled git failed --version:", ver.stderr || ver.stdout);
    process.exit(1);
  }

  const sizeMb = (
    spawnSync("du", ["-sk", outDir], { encoding: "utf8" }).stdout.split(/\s+/)[0] / 1024
  ).toFixed(1);

  writeFileSync(
    join(outDir, "git-version.txt"),
    `${(ver.stdout || "").trim()}\nsource=${url}\n`,
    "utf8",
  );

  console.log(`Bundled portable Git → ${outDir} (~${sizeMb} MB)`);
  console.log((ver.stdout || "").trim());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
