#!/usr/bin/env node
/**
 * Agent runtime, driven over the parent process IPC channel instead of HTTP.
 *
 * Why this exists: the daemon used to serve the renderer's code-split chunks on
 * the same event loop that loads the agent SDK. Loading the SDK blocks that loop
 * for ~10-20s on a cold Windows install, so the window painted instantly and
 * then sat empty waiting for JavaScript it could not fetch. The desktop shell
 * now serves its own assets and talks to this process over a private channel,
 * so runtime stalls can only delay data — never rendering.
 *
 * Protocol (parent → here):
 *   { t:"req", id, method, path, headers, body?, stream? }
 *   { t:"abort", id }
 * Here → parent:
 *   { t:"res", id, status, headers, body }          buffered, body is base64
 *   { t:"open", id, status, headers }               streaming, then…
 *   { t:"chunk", id, chunk } … { t:"end", id }      chunk is base64
 *   { t:"err", id, message }
 *
 * Bodies are base64 because the channel uses JSON serialization: V8 structured
 * clone would be denser, but Electron's V8 and the bundled Node's disagree on
 * its format and the channel dies on the first message.
 */
import { dispatch, libModule, loadModule, noteClientActivity, scheduleDeferredBoot } from "./dispatch.mjs";
import { NextRequest } from "./shims/next-server.mjs";

// Handlers build URLs with `new URL(request.url)`, so they need an absolute
// origin even though nothing is listening on it.
const ORIGIN = "http://desktop.invalid";

/** @type {Map<string, AbortController>} */
const inFlight = new Map();

function send(message) {
  try {
    process.send?.(message);
  } catch (error) {
    console.error("[runtime] ipc send failed:", error);
  }
}

function headersToObject(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Streaming responses (SSE) must arrive incrementally or the UI never updates. */
async function pumpStream(id, response) {
  send({ t: "open", id, status: response.status, headers: headersToObject(response.headers) });
  const reader = response.body?.getReader();
  if (!reader) {
    send({ t: "end", id });
    return;
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      send({ t: "chunk", id, chunk: Buffer.from(value).toString("base64") });
    }
  } catch (error) {
    send({ t: "err", id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    reader.releaseLock?.();
    send({ t: "end", id });
    inFlight.delete(id);
  }
}

async function handleRequest(message) {
  const { id, method, path: reqPath, headers, body, bodyEncoding, stream } = message;
  const controller = new AbortController();
  inFlight.set(id, controller);
  try {
    /** @type {RequestInit & { duplex?: string }} */
    const init = {
      method: method || "GET",
      headers: new Headers(headers || {}),
      signal: controller.signal,
    };
    if (body != null && init.method !== "GET" && init.method !== "HEAD") {
      // Both encodings arrive as strings, so the marker is what disambiguates.
      init.body = bodyEncoding === "base64" ? Buffer.from(body, "base64") : body;
    }
    const request = new NextRequest(`${ORIGIN}${reqPath}`, init);
    const response = await dispatch(request);

    if (stream) {
      await pumpStream(id, response);
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    send({
      t: "res",
      id,
      status: response.status,
      headers: headersToObject(response.headers),
      body: buffer.toString("base64"),
    });
    inFlight.delete(id);
  } catch (error) {
    send({ t: "err", id, message: error instanceof Error ? error.message : String(error) });
    inFlight.delete(id);
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.t === "req") {
    noteClientActivity();
    void handleRequest(message);
    return;
  }
  if (message.t === "abort") {
    inFlight.get(message.id)?.abort();
    inFlight.delete(message.id);
  }
});

process.on("disconnect", () => process.exit(0));

const role = process.env.PI_WEB_RUNTIME_ROLE || "heavy";
send({ t: "ready" });
console.log(`[runtime:${role}] ipc host ready (no HTTP)`);

if (role !== "light") {
  // Pull the agent SDK in now rather than on the first request that needs it.
  //
  // Packaged builds ship a single-file SDK bundle; native import loads it in
  // ~0.5s warm. jiti re-walks that graph through its own loader and measured
  // ~20s for the same file — so preload MUST go through loadModule (native
  // .mjs path), never jiti() directly. The light runtime keeps answering the
  // session list while this runs.
  const t0 = Date.now();
  try {
    await loadModule(libModule("session-entries"));
    console.log(`[runtime:heavy] agent SDK ready in ${Date.now() - t0}ms`);
  } catch (error) {
    console.error("[runtime:heavy] SDK preload failed:", error);
  }
  scheduleDeferredBoot();
}
