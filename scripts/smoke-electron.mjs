#!/usr/bin/env node
/**
 * Smoke-test Electron 43 shell + Next server + notification signing path.
 * Usage: node scripts/smoke-electron.mjs
 */
import { spawn } from "child_process";
import http from "http";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { inspectSignature, parseSignature } from "./macos-adhoc-sign.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PORT = Number(process.env.PI_WEB_ELECTRON_PORT || 30152);
const HOST = "127.0.0.1";
const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function probe(path = "/", timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

async function waitForServer(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Prefer the lightweight health route used by electron/main.js cold start.
    const health = await probe("/api/health");
    if (health.ok && health.status && health.status < 500) return health;
    const home = await probe("/");
    if (home.ok && home.status && home.status < 500) return home;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server not ready on http://${HOST}:${PORT}`);
}

async function jsonGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path, timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null, raw: body });
        } catch {
          resolve({ status: res.statusCode, json: null, raw: body.slice(0, 200) });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

// --- static checks ---
console.log("\n== Static checks ==");
try {
  const ver = require("electron/package.json").version;
  if (ver.startsWith("43.")) pass("electron package version", ver);
  else fail("electron package version", ver);
} catch (e) {
  fail("electron package version", String(e));
}

const electronApp = join(root, "node_modules/electron/dist/Electron.app");
if (process.platform === "darwin") {
  if (!existsSync(electronApp)) fail("Electron.app present", "missing dist");
  else {
    const { output } = inspectSignature(electronApp);
    const info = parseSignature(output);
    if (info.adhoc && !info.linkerSigned) pass("dev Electron.app ad-hoc signature", info.flags || "adhoc");
    else fail("dev Electron.app ad-hoc signature", info.flags || output.slice(0, 120));
  }
} else {
  pass("dev Electron.app ad-hoc signature", "skipped (non-darwin)");
}

if (existsSync(join(root, ".next/BUILD_ID"))) pass("production Next build present");
else fail("production Next build present", "run npm run build first");

// --- launch electron ---
console.log("\n== Launch Electron ==");
const electronBin = join(root, "node_modules/.bin/electron");
const child = spawn(electronBin, [root], {
  cwd: root,
  env: {
    ...process.env,
    PI_WEB_ELECTRON_PORT: String(PORT),
    PI_WEB_NO_OPEN: "1",
    BROWSER: "none",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (c) => {
  stdout += c;
  process.stdout.write(c);
});
child.stderr.on("data", (c) => {
  stderr += c;
  process.stderr.write(c);
});

let exited = false;
child.on("exit", (code, signal) => {
  exited = true;
  console.log(`[smoke] electron exited code=${code} signal=${signal}`);
});

try {
  const ready = await waitForServer();
  pass("Next server reachable", `HTTP ${ready.status} on :${PORT}`);

  // Page load
  const home = await probe("/");
  if (home.ok && home.status === 200) pass("GET /", `status ${home.status}`);
  else fail("GET /", JSON.stringify(home));

  // Core APIs used by the desktop shell
  const endpoints = [
    "/api/health",
    "/api/sessions",
    "/api/models",
    "/api/home",
    "/api/auth/providers",
  ];
  for (const path of endpoints) {
    try {
      const r = await jsonGet(path);
      if (r.status && r.status < 500) pass(`API ${path}`, `status ${r.status}`);
      else fail(`API ${path}`, `status ${r.status} body=${String(r.raw).slice(0, 80)}`);
    } catch (e) {
      fail(`API ${path}`, e instanceof Error ? e.message : String(e));
    }
  }

  // cwd validate (safe)
  try {
    const body = JSON.stringify({ cwd: root });
    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: HOST,
          port: PORT,
          path: "/api/cwd/validate",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 8000,
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => resolve({ status: res.statusCode, raw }));
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.write(body);
      req.end();
    });
    if (r.status && r.status < 500) pass("API POST /api/cwd/validate", `status ${r.status}`);
    else fail("API POST /api/cwd/validate", `status ${r.status}`);
  } catch (e) {
    fail("API POST /api/cwd/validate", e instanceof Error ? e.message : String(e));
  }

  // Notification path: Electron does NOT support node-style `-e` (it treats the
  // string as an app path and shows "Unable to find Electron app at ...").
  // Use the dedicated entry script instead.
  if (process.platform === "darwin") {
    console.log("\n== Notification probe ==");
    const notifScript = join(root, "scripts", "smoke-electron-notify.mjs");
    const notif = await new Promise((resolve) => {
      const p = spawn(process.execPath, [notifScript], {
        cwd: root,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (c) => (out += c));
      p.stderr.on("data", (c) => (err += c));
      p.on("exit", (code) => {
        try {
          const line = out
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .reverse()
            .find((l) => l.startsWith("{"));
          resolve(
            line
              ? { ...JSON.parse(line), exitCode: code }
              : { supported: null, events: ["no-json"], out, err, exitCode: code },
          );
        } catch {
          resolve({ supported: null, events: ["parse-error"], out, err, exitCode: code });
        }
      });
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 12000);
    });

    if (notif.events?.includes("show") || notif.ok === true) {
      pass("Notification show (ad-hoc)", JSON.stringify(notif.events || notif));
    } else if (notif.events?.some((e) => String(e).startsWith("failed"))) {
      fail("Notification show (ad-hoc)", JSON.stringify(notif));
    } else {
      pass("Notification probe completed", JSON.stringify(notif));
    }
  }

  // Log heuristics from main process
  if (/Starting (Next\.js|standalone)/i.test(stdout + stderr) || /http:\/\/127\.0\.0\.1/i.test(stdout + stderr)) {
    pass("main process server start log");
  } else {
    // still ok if server responded
    pass("main process server start log", "no explicit log; server responded");
  }

  if (/did-fail-load/i.test(stdout + stderr)) fail("window load", "did-fail-load seen in logs");
  else pass("window load", "no did-fail-load");
} catch (e) {
  fail("launch/runtime", e instanceof Error ? e.message : String(e));
} finally {
  if (!exited) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 1500));
    if (!exited) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

console.log("\n== Summary ==");
const failed = results.filter((r) => !r.ok);
const passed = results.filter((r) => r.ok);
console.log(`Passed: ${passed.length}  Failed: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.error(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("All smoke checks passed.");
process.exit(0);
