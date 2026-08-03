#!/usr/bin/env node
/**
 * Smoke: daemon listens without Next, health is fast, basic APIs respond.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, HOST, () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: p, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${p}`));
    });
  });
}

async function waitHealth(port, timeoutMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await get(port, "/api/health");
      if (r.status === 200 && r.body.trim() === "ok") {
        return Date.now() - t0;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("health timeout");
}

const port = await freePort();
const child = spawn(process.execPath, [path.join(root, "daemon", "server.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: HOST,
    PI_WEB_PREWARM_DELAY_MS: "60000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout?.on("data", (c) => {
  logs += c.toString();
  process.stdout.write(c);
});
child.stderr?.on("data", (c) => {
  logs += c.toString();
  process.stderr.write(c);
});

try {
  const healthMs = await waitHealth(port);
  console.log(`[smoke:daemon] health ok in ${healthMs}ms`);

  if (healthMs > 3000) {
    console.warn(`[smoke:daemon] WARN health took ${healthMs}ms (want <1000ms warm machine)`);
  }

  const home = await get(port, "/api/home");
  if (home.status !== 200) throw new Error(`/api/home status ${home.status}: ${home.body}`);
  const homeJson = JSON.parse(home.body);
  if (!homeJson.home) throw new Error("/api/home missing home");
  console.log("[smoke:daemon] /api/home ok");

  if (logs.includes("next start") || logs.includes("Next.js")) {
    // daemon may print "no Next.js" — only fail on actual next boot markers
    if (logs.includes("Starting Next.js") || logs.includes("next start")) {
      throw new Error("daemon logs suggest Next.js was started");
    }
  }

  console.log("[smoke:daemon] PASS");
  process.exitCode = 0;
} catch (err) {
  console.error("[smoke:daemon] FAIL", err);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    process.exit(process.exitCode ?? 0);
  }, 500).unref?.();
}
