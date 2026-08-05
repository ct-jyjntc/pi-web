#!/usr/bin/env node
/**
 * Smoke test for the IPC agent runtime: spawn daemon/ipc-host.mjs the way
 * electron/runtime-host.js does, then exercise a buffered request and a
 * streaming one. Catches protocol/serialization breakage without a full build.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "daemon", "ipc-host.mjs");

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production", PI_WEB_PREWARM_DELAY_MS: "600000" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
child.stdout.on("data", (c) => process.stdout.write(`  [runtime] ${c}`));
child.stderr.on("data", (c) => process.stderr.write(`  [runtime!] ${c}`));

const pending = new Map();
const streamChunks = [];
let streamEnded = null;

child.on("message", (msg) => {
  if (msg.t === "ready") return;
  if (msg.t === "res" || msg.t === "err") {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.t === "chunk") streamChunks.push(Buffer.from(msg.chunk, "base64").toString("utf8"));
  if (msg.t === "end") streamEnded?.();
});

function request(id, payload) {
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.t === "err" ? reject(new Error(msg.message)) : resolve(msg)));
    child.send({ t: "req", id, ...payload });
    setTimeout(() => reject(new Error(`timeout: ${payload.path}`)), 120_000).unref();
  });
}

function fail(message) {
  console.error(`[smoke:ipc] FAIL — ${message}`);
  child.kill();
  process.exit(1);
}

try {
  const home = await request("a", { method: "GET", path: "/api/home", headers: {} });
  if (home.status !== 200) fail(`/api/home status ${home.status}`);
  const homeBody = JSON.parse(Buffer.from(home.body, "base64").toString("utf8"));
  if (typeof homeBody.home !== "string") fail(`/api/home body: ${JSON.stringify(homeBody)}`);
  console.log(`[smoke:ipc] /api/home ok (${homeBody.home})`);

  const sessions = await request("b", { method: "GET", path: "/api/sessions", headers: {} });
  if (sessions.status !== 200) fail(`/api/sessions status ${sessions.status}`);
  const list = JSON.parse(Buffer.from(sessions.body, "base64").toString("utf8"));
  if (!Array.isArray(list.sessions)) fail("/api/sessions did not return a list");
  console.log(`[smoke:ipc] /api/sessions ok (${list.sessions.length} sessions)`);

  const missing = await request("c", { method: "GET", path: "/api/definitely-not-a-route", headers: {} });
  if (missing.status !== 404) fail(`unknown route returned ${missing.status}`);
  console.log("[smoke:ipc] unknown route -> 404 ok");

  // Streaming: pty events is an SSE route that opens immediately.
  const streamDone = new Promise((resolve) => {
    streamEnded = resolve;
  });
  child.send({
    t: "req",
    id: "s1",
    method: "GET",
    path: `/api/cwd/pty/events?cwd=${encodeURIComponent(root)}`,
    headers: {},
    stream: true,
  });
  await Promise.race([
    streamDone,
    new Promise((resolve) => setTimeout(resolve, 6_000)),
  ]);
  child.send({ t: "abort", id: "s1" });
  if (streamChunks.length === 0) fail("SSE route produced no chunks");
  console.log(`[smoke:ipc] SSE ok (${streamChunks.length} chunk(s), first: ${JSON.stringify(streamChunks[0].slice(0, 60))})`);

  console.log("[smoke:ipc] PASS");
  child.kill();
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
