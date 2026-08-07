"use strict";
/**
 * Owns the agent runtime child processes and bridges renderer `/api` calls to them.
 *
 * Runtimes are spawned with the bundled Node binary (not Electron's) because they
 * load native modules built for that ABI, and talk over the child IPC channel
 * rather than a loopback port — nothing about the desktop client is a web server
 * any more, so runtime stalls can never hold up the window's own assets.
 */
const { spawn } = require("node:child_process");

const REQUEST_CHANNEL = "pi-api:request";
const STREAM_OPEN_CHANNEL = "pi-api:stream-open";
const STREAM_CLOSE_CHANNEL = "pi-api:stream-close";
const STREAM_EVENT_CHANNEL = "pi-api:stream";
const ABORT_CHANNEL = "pi-api:abort";

/**
 * Two runtimes, split by whether a route needs the agent SDK.
 *
 * Loading the SDK + tool graph is ~5s warm and ~17s cold on Windows — 2400 files
 * of mostly filesystem cost — and it blocks its process for the duration. With a
 * single runtime the session list, file tree and git status queued behind it.
 * These paths reach none of it, so they get a process that never loads it.
 *
 * Misclassifying is safe in one direction only: the heavy runtime can serve
 * anything, so an unlisted path is merely as slow as before. A path listed here
 * that *does* reach the SDK would drag it into the light runtime — only add
 * routes verified free of it (no static `@earendil-works/*`, no ModelRuntime,
 * no SessionManager / session-entries / utility-model).
 *
 * Prefer EXACT matches for single routes. PREFIX matches must not cover sibling
 * subpaths that need the SDK (e.g. `/api/models-config` must NOT prefix-match
 * `/api/models-config/provider-models`).
 */
const LIGHT_EXACT = new Set([
  "/api/home",
  "/api/sessions",
  "/api/web-settings",
  "/api/health",
  "/api/default-cwd",
  "/api/github",
  "/api/checkpoints",
  "/api/workspace-journal",
  "/api/permissions",
  "/api/mcp",
  // models.json CRUD only — subpaths that touch ModelRuntime stay heavy.
  "/api/models-config",
  "/api/debug/sessions",
  "/api/skills/install",
  "/api/skills/search",
]);

const LIGHT_PREFIXES = [
  "/api/files/",
  "/api/git/",
  "/api/cwd/",
  "/api/worktrees",
  "/api/usage",
  "/api/app-update",
  "/api/file-index",
  "/api/diagnostics",
  "/api/commands",
  "/api/permissions",
  "/api/mcp",
  "/api/lsp",
  // models-config subpaths verified free of ModelRuntime / SDK:
  "/api/models-config/free-models",
  "/api/models-config/disabled-models",
  // provider-models without ?fresh=1 is routed in roleForPath (cache-only light).
  // NOT light: /model-overrides, /test, /discover (ModelRuntime)
];

/** @param {string} rawPath */
function roleForPath(rawPath) {
  const raw = rawPath || "";
  const qIndex = raw.indexOf("?");
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = qIndex >= 0 ? raw.slice(qIndex + 1) : "";

  // Built-in provider catalogs: default is cache-only (light). Live refresh
  // (?fresh=1) needs ModelRuntime and must stay on heavy.
  if (pathname === "/api/models-config/provider-models") {
    return new URLSearchParams(query).get("fresh") === "1" ? "heavy" : "light";
  }

  if (LIGHT_EXACT.has(pathname)) return "light";
  return LIGHT_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ? "light" : "heavy";
}

/** @type {{ light: import('node:child_process').ChildProcess | null, heavy: import('node:child_process').ChildProcess | null }} */
const children = { light: null, heavy: null };
let nextId = 0;
/** id → { resolve, reject, role } for buffered requests. */
const pending = new Map();
/** id → { webContents, streamId, role } for streaming requests. */
const streams = new Map();

function newId() {
  nextId += 1;
  return `r${nextId}`;
}

function handleRuntimeMessage(message) {
  if (!message || typeof message !== "object") return;
  const { t, id } = message;

  if (t === "res") {
    pending.get(id)?.resolve({
      status: message.status,
      headers: message.headers,
      body: message.body,
    });
    pending.delete(id);
    return;
  }
  if (t === "err") {
    const waiter = pending.get(id);
    if (waiter) {
      waiter.reject(new Error(message.message || "runtime error"));
      pending.delete(id);
      return;
    }
  }

  const stream = streams.get(id);
  if (!stream) return;
  if (stream.webContents.isDestroyed()) {
    streams.delete(id);
    return;
  }
  stream.webContents.send(STREAM_EVENT_CHANNEL, { ...message, streamId: stream.streamId });
  if (t === "end" || t === "err") streams.delete(id);
}

/**
 * @param {{ entry: string, cwd: string, env: NodeJS.ProcessEnv, nodeBinary: string,
 *           onLog?: (chunk: Buffer) => void, onExit?: (child: import('node:child_process').ChildProcess) => void }} options
 */
function startRuntime({ entry, cwd, env, nodeBinary, onLog, onExit }) {
  for (const role of ["light", "heavy"]) {
    console.log(`[electron] Starting ${role} agent runtime over IPC`);
    const proc = spawn(nodeBinary, [entry], {
      cwd,
      // The light runtime must never prewarm the builtin extensions — that is
      // exactly the SDK load this split keeps away from it.
      env: { ...env, PI_WEB_RUNTIME_ROLE: role },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      // Default JSON serialization on purpose: `serialization: "advanced"` is V8
      // structured clone, and Electron's V8 differs from the bundled Node's,
      // which fails the channel outright ("unsupported version"). Bodies cross
      // as base64 strings instead — see daemon/ipc-host.mjs.
    });
    proc.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk);
      onLog?.(chunk);
    });
    proc.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      onLog?.(chunk);
    });
    proc.on("message", handleRuntimeMessage);
    proc.on("exit", () => {
      children[role] = null;
      // Only fail what this runtime still owed an answer for.
      for (const [id, waiter] of pending) {
        if (waiter.role !== role) continue;
        waiter.reject(new Error(`${role} agent runtime exited`));
        pending.delete(id);
      }
      for (const [id, stream] of streams) {
        if (stream.role === role) streams.delete(id);
      }
    });
    children[role] = proc;
    onExit?.(proc);
  }
  return children.heavy;
}

function sendToRuntime(role, message) {
  const proc = children[role];
  if (!proc || !proc.connected) throw new Error(`${role} agent runtime is not running`);
  // The callback form is required, not optional: without it a failed write
  // (EPIPE while the runtime is exiting, e.g. on window close) surfaces as an
  // uncaught exception in the main process and Electron shows an error dialog.
  proc.send(message, (error) => {
    if (error) console.warn(`[electron] ${role} runtime send failed: ${error.message}`);
  });
}

/** @param {Electron.IpcMain} ipcMain */
function registerApiBridge(ipcMain) {
  ipcMain.handle(REQUEST_CHANNEL, async (_event, payload) => {
    const id = payload?.requestId || newId();
    const role = roleForPath(payload?.path);
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject, role }));
    sendToRuntime(role, {
      t: "req",
      id,
      method: payload?.method || "GET",
      path: payload?.path,
      headers: payload?.headers || {},
      body: payload?.body,
      bodyEncoding: payload?.bodyEncoding,
    });
    return result;
  });

  // Without this an aborted fetch — a superseded session load, a sidebar poll
  // cancelled on unmount — keeps running in the runtime and its work piles up
  // behind whatever the user is actually waiting for.
  ipcMain.on(ABORT_CHANNEL, (_event, payload) => {
    const id = payload?.requestId;
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    waiter.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    try {
      sendToRuntime(waiter.role, { t: "abort", id });
    } catch {
      // runtime already gone
    }
  });

  ipcMain.on(STREAM_OPEN_CHANNEL, (event, payload) => {
    const id = newId();
    const role = roleForPath(payload?.path);
    streams.set(id, { webContents: event.sender, streamId: payload?.streamId, role });
    // Renderer reloads leave orphaned streams; drop them with their window.
    event.sender.once("destroyed", () => {
      if (streams.delete(id)) {
        try {
          sendToRuntime(role, { t: "abort", id });
        } catch {
          // runtime already gone
        }
      }
    });
    try {
      sendToRuntime(role, {
        t: "req",
        id,
        method: "GET",
        path: payload?.path,
        headers: payload?.headers || {},
        stream: true,
      });
    } catch (error) {
      event.sender.send(STREAM_EVENT_CHANNEL, {
        t: "err",
        streamId: payload?.streamId,
        message: error instanceof Error ? error.message : String(error),
      });
      streams.delete(id);
    }
  });

  ipcMain.on(STREAM_CLOSE_CHANNEL, (_event, payload) => {
    for (const [id, stream] of streams) {
      if (stream.streamId !== payload?.streamId) continue;
      streams.delete(id);
      try {
        sendToRuntime(stream.role, { t: "abort", id });
      } catch {
        // runtime already gone
      }
      break;
    }
  });
}

/** The SDK-backed runtime — what callers mean by "the server process". */
function getRuntimeProcess() {
  return children.heavy;
}

module.exports = {
  startRuntime,
  registerApiBridge,
  getRuntimeProcess,
  roleForPath,
  LIGHT_EXACT,
  LIGHT_PREFIXES,
};
