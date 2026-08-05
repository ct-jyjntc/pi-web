#!/usr/bin/env node
/**
 * Exercises the flows the boot-path smoke test never touches: a binary/FormData
 * upload (the base64 request path), a pty round-trip (streaming both ways), and
 * an agent event stream. Typecheck passing says nothing about these.
 */
import { spawn } from "node:child_process";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "daemon", "ipc-host.mjs");

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production", PI_WEB_PREWARM_DELAY_MS: "600000" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
child.stderr.on("data", (c) => process.stderr.write(`  [!] ${c}`));

const pending = new Map();
const streamHandlers = new Map();
child.on("message", (m) => {
  if (m.t === "res" || m.t === "err") {
    const waiter = pending.get(m.id);
    if (waiter) {
      pending.delete(m.id);
      waiter(m);
      return;
    }
  }
  streamHandlers.get(m.id)?.(m);
});

let seq = 0;
function request(payload) {
  const id = `q${(seq += 1)}`;
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.t === "err" ? reject(new Error(m.message)) : resolve(m)));
    child.send({ t: "req", id, headers: {}, ...payload });
    setTimeout(() => reject(new Error(`timeout ${payload.path}`)), 120_000).unref();
  });
}
function openStream(payload, onMessage) {
  const id = `s${(seq += 1)}`;
  streamHandlers.set(id, onMessage);
  child.send({ t: "req", id, headers: {}, stream: true, ...payload });
  return () => child.send({ t: "abort", id });
}
const text = (m) => Buffer.from(m.body, "base64").toString("utf8");
const json = (m) => JSON.parse(text(m));

let failed = false;
function check(name, ok, detail = "") {
  console.log(`[smoke:flows] ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

const workdir = path.join(root, ".smoke-flows");
await mkdir(workdir, { recursive: true });
try {
  // /api/files is an allow-list, not a browser: register the dir the way the UI does.
  const validated = await request({
    method: "POST",
    path: "/api/cwd/validate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: workdir }),
    bodyEncoding: "utf8",
  });
  check("cwd validate allows the temp dir", validated.status < 400, `status=${validated.status}`);

  // 1. Multipart upload — exercises the base64 request body path end to end.
  const boundary = "----pisplit";
  const payload =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="files"; filename="hello.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `hello from ipc\r\n` +
    `--${boundary}--\r\n`;
  const upload = await request({
    method: "POST",
    path: `/api/files/${encodeURIComponent(workdir)}?type=upload`,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.from(payload, "utf8").toString("base64"),
    bodyEncoding: "base64",
  });
  const uploaded = path.join(workdir, "hello.txt");
  let uploadedBody = null;
  try {
    uploadedBody = await readFile(uploaded, "utf8");
  } catch {
    // left null
  }
  check(
    "multipart upload writes the file",
    upload.status < 400 && uploadedBody === "hello from ipc",
    `status=${upload.status} body=${JSON.stringify(uploadedBody)}`,
  );

  // 2. Binary read back — response bodies that are not JSON.
  const read = await request({
    method: "GET",
    path: `/api/files/${encodeURIComponent(uploaded)}?type=read`,
  });
  check("file read round-trips", read.status === 200 && text(read).includes("hello from ipc"), `status=${read.status}`);

  // 3. pty: create, stream, write, observe echo.
  const create = await request({
    method: "POST",
    path: "/api/cwd/pty",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: workdir }),
    bodyEncoding: "utf8",
  });
  const ptyId = create.status < 400 ? (json(create).id ?? json(create).ptyId) : null;
  check("pty session created", Boolean(ptyId), `status=${create.status}`);

  if (ptyId) {
    let sawData = false;
    const close = openStream({ method: "GET", path: `/api/cwd/pty/${encodeURIComponent(ptyId)}/events` }, (m) => {
      if (m.t === "chunk" && Buffer.from(m.chunk, "base64").toString("utf8").includes("data:")) sawData = true;
    });
    await new Promise((r) => setTimeout(r, 1500));
    await request({
      method: "POST",
      path: `/api/cwd/pty/${encodeURIComponent(ptyId)}/input`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "echo pi-ipc-probe\r" }),
      bodyEncoding: "utf8",
    });
    await new Promise((r) => setTimeout(r, 2500));
    close();
    check("pty streams output back", sawData);
    await request({ method: "DELETE", path: `/api/cwd/pty/${encodeURIComponent(ptyId)}` }).catch(() => {});
  }

  // 4. Agent event stream connects for an existing session (no prompt sent).
  const list = await request({ method: "GET", path: "/api/sessions" });
  const first = (json(list).sessions ?? [])[0];
  if (first) {
    let opened = false;
    const close = openStream(
      { method: "GET", path: `/api/agent/${encodeURIComponent(first.id)}/events` },
      (m) => {
        if (m.t === "open" || m.t === "chunk") opened = true;
        if (m.t === "err") console.log(`  stream err: ${m.message}`);
        if (m.t === "open") console.log(`  stream open: status=${m.status}`);
        if (m.t === "end" && !opened) console.log("  stream ended without opening");
      },
    );
    await new Promise((r) => setTimeout(r, 45_000));
    close();
    check("agent event stream opens", opened, `session=${first.id.slice(0, 8)}`);
  } else {
    console.log("[smoke:flows] skip agent stream — no sessions on this machine");
  }
} finally {
  await rm(workdir, { recursive: true, force: true });
  child.kill();
}

console.log(failed ? "[smoke:flows] FAIL" : "[smoke:flows] PASS");
process.exit(failed ? 1 : 0);
