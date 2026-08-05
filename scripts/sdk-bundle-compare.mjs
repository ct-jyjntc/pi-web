#!/usr/bin/env node
/**
 * Functional + load-time compare: multi-file package vs packaged single-file
 * entries under a target tree (default: a temp copy of the collapsed shape).
 *
 * Usage:
 *   node scripts/sdk-bundle-compare.mjs
 *   node scripts/sdk-bundle-compare.mjs --target .next/standalone
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const targetArg = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : null;

function findJsonl(dir, depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const hit = findJsonl(full, depth + 1);
      if (hit) return hit;
    } else if (name.endsWith(".jsonl") && st.size > 200) {
      return full;
    }
  }
  return null;
}

async function exercise(label, sdk) {
  const t0 = Date.now();
  // load time is measured by caller before this runs; keep API work here
  const agentDir = sdk.getAgentDir();
  const cwd = process.cwd();
  const store = new sdk.ProjectTrustStore(agentDir);
  const trust = store.get(cwd);
  const requires = sdk.hasTrustRequiringProjectResources(cwd);

  let session = null;
  const file = findJsonl(path.join(agentDir, "sessions"));
  if (file) {
    const manager = sdk.SessionManager.open(file);
    const entries = manager.getEntries();
    const ctx = sdk.buildSessionContext(entries);
    session = {
      id: manager.getSessionId(),
      entries: entries.length,
      messages: ctx?.messages?.length ?? 0,
      firstRole: ctx?.messages?.[0]?.role ?? null,
    };
  }

  let themeOk = false;
  let themeErr = null;
  try {
    if (typeof sdk.initTheme === "function") {
      sdk.initTheme();
      themeOk = true;
    }
  } catch (error) {
    themeErr = error instanceof Error ? error.message : String(error);
  }

  const settings = sdk.SettingsManager.create(cwd, agentDir);
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const ext = loader.getExtensions();

  const needed = [
    "SessionManager",
    "buildSessionContext",
    "buildContextEntries",
    "createAgentSessionFromServices",
    "createAgentSessionServices",
    "getAgentDir",
    "initTheme",
    "ProjectTrustStore",
    "hasTrustRequiringProjectResources",
    "DefaultResourceLoader",
    "SettingsManager",
  ];
  const missing = needed.filter((k) => !(k in sdk));

  return {
    label,
    apiMs: Date.now() - t0,
    exports: Object.keys(sdk).length,
    trust: String(trust),
    requires,
    session,
    themeOk,
    themeErr,
    extensions: ext.extensions?.length ?? 0,
    extErrors: ext.errors?.length ?? 0,
    missing,
  };
}

async function loadRaw() {
  const t0 = Date.now();
  const sdk = await import("@earendil-works/pi-coding-agent");
  return { sdk, loadMs: Date.now() - t0 };
}

async function loadTarget(targetRoot) {
  const index = path.join(
    targetRoot,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "index.js",
  );
  if (!fs.existsSync(index)) {
    throw new Error(`missing bundled index at ${index}`);
  }
  const t0 = Date.now();
  const sdk = await import(pathToFileURL(index).href);
  return { sdk, loadMs: Date.now() - t0 };
}

const raw = await loadRaw();
const rawReport = await exercise("raw", raw.sdk);
rawReport.loadMs = raw.loadMs;

let bunReport = null;
if (targetArg) {
  const bundled = await loadTarget(targetArg);
  bunReport = await exercise("bundle", bundled.sdk);
  bunReport.loadMs = bundled.loadMs;
} else {
  // Dev probe path used during development of the bundler.
  const probe = path.resolve(".sdk-bundle-probe/sdk.mjs");
  if (fs.existsSync(probe)) {
    const t0 = Date.now();
    const sdk = await import(pathToFileURL(probe).href);
    bunReport = await exercise("probe", sdk);
    bunReport.loadMs = Date.now() - t0;
  }
}

console.log(JSON.stringify({ raw: rawReport, bundle: bunReport }, null, 2));

if (bunReport) {
  const ok =
    rawReport.exports === bunReport.exports &&
    rawReport.session?.id === bunReport.session?.id &&
    rawReport.session?.entries === bunReport.session?.entries &&
    rawReport.session?.messages === bunReport.session?.messages &&
    rawReport.missing.length === 0 &&
    bunReport.missing.length === 0 &&
    bunReport.themeOk;
  if (!ok) {
    console.error("COMPARE FAILED");
    process.exit(1);
  }
  console.log(
    `OK raw_load=${rawReport.loadMs}ms bundle_load=${bunReport.loadMs}ms entries=${rawReport.session?.entries}`,
  );
}
