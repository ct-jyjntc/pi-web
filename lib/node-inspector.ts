/**
 * Node.js Inspector (CDP) session manager — practical DAP-adjacent debugging.
 * Launch with --inspect-brk, set breakpoints, continue, evaluate, stack.
 */
import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import WebSocket from "ws";

export type DebugSessionInfo = {
  id: string;
  cwd: string;
  command: string;
  inspectUrl: string;
  pid: number | null;
  status: "starting" | "paused" | "running" | "exited" | "error";
  lastStop?: { reason?: string; callFrames?: DebugFrame[] };
  exitCode?: number | null;
  error?: string;
};

export type DebugFrame = {
  callFrameId: string;
  functionName: string;
  url: string;
  lineNumber: number; // 0-based from CDP → we expose 1-based in tools
  columnNumber: number;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

class InspectorConnection {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private scripts = new Map<string, string>(); // scriptId -> url
  private pauseWaiters: Array<(payload: unknown) => void> = [];
  lastPausedParams: unknown = null;
  onPaused: ((payload: unknown) => void) | null = null;
  onResumed: (() => void) | null = null;
  onExit: (() => void) | null = null;

  async connect(wsUrl: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.on("open", () => resolvePromise());
      ws.on("error", (err: Error) => reject(err instanceof Error ? err : new Error(String(err))));
      ws.on("message", (data: WebSocket.RawData) => this.onMessage(String(data)));
      ws.on("close", () => {
        for (const [, p] of this.pending) p.reject(new Error("Inspector disconnected"));
        this.pending.clear();
        this.onExit?.();
      });
    });
    await this.send("Debugger.enable", {});
    await this.send("Runtime.enable", {});
    // Node --inspect-brk waits here until the debugger resumes startup.
    try {
      await this.send("Runtime.runIfWaitingForDebugger", {});
    } catch {
      // older runtimes may not implement this; ignore
    }
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || "CDP error"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "Debugger.scriptParsed") {
      const p = msg.params as { scriptId?: string; url?: string };
      if (p.scriptId && p.url) this.scripts.set(p.scriptId, p.url);
    }
    if (msg.method === "Debugger.paused") {
      this.lastPausedParams = msg.params;
      const waiters = this.pauseWaiters.splice(0, this.pauseWaiters.length);
      for (const w of waiters) w(msg.params);
      this.onPaused?.(msg.params);
    }
    if (msg.method === "Debugger.resumed") {
      this.lastPausedParams = null;
      this.onResumed?.();
    }
  }

  waitForPaused(timeoutMs = 10_000): Promise<unknown> {
    if (this.lastPausedParams) return Promise.resolve(this.lastPausedParams);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pauseWaiters = this.pauseWaiters.filter((w) => w !== waiter);
        reject(new Error("Timed out waiting for Debugger.paused"));
      }, timeoutMs);
      const waiter = (payload: unknown) => {
        clearTimeout(timer);
        resolvePromise(payload);
      };
      this.pauseWaiters.push(waiter);
    });
  }

  send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Inspector not connected"));
    }
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15_000);
    });
  }

  async setBreakpointByUrl(urlOrFile: string, line: number /* 1-based */): Promise<string> {
    // Node often uses file:// URLs
    let url = urlOrFile;
    if (!url.includes("://") && existsSync(url)) {
      url = `file://${resolve(url)}`;
    }
    const result = await this.send("Debugger.setBreakpointByUrl", {
      lineNumber: Math.max(0, line - 1),
      url,
    }) as { breakpointId?: string };
    // also try regex on basename if needed
    if (!result.breakpointId) {
      const base = url.split("/").pop() ?? url;
      const r2 = await this.send("Debugger.setBreakpointByUrl", {
        lineNumber: Math.max(0, line - 1),
        urlRegex: base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      }) as { breakpointId?: string };
      return r2.breakpointId || "";
    }
    return result.breakpointId || "";
  }

  async resume(): Promise<void> {
    await this.send("Debugger.resume", {});
  }

  async pause(): Promise<void> {
    await this.send("Debugger.pause", {});
  }

  async evaluate(expression: string, callFrameId?: string): Promise<string> {
    if (callFrameId) {
      const result = await this.send("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression,
        returnByValue: true,
      }) as { result?: { value?: unknown; description?: string; type?: string }; exceptionDetails?: { text?: string } };
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
      return formatRemote(result.result);
    }
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: unknown; description?: string; type?: string }; exceptionDetails?: { text?: string } };
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
    return formatRemote(result.result);
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}

function formatRemote(result?: { value?: unknown; description?: string; type?: string }): string {
  if (!result) return "undefined";
  if (result.value !== undefined) {
    try { return JSON.stringify(result.value, null, 2); } catch { return String(result.value); }
  }
  return result.description || result.type || "unknown";
}

type LiveSession = {
  info: DebugSessionInfo;
  child: ChildProcess | null;
  conn: InspectorConnection | null;
  logs: string[];
};

declare global {
  // eslint-disable-next-line no-var
  var __piDebugSessions: Map<string, LiveSession> | undefined;
}

function pool(): Map<string, LiveSession> {
  if (!globalThis.__piDebugSessions) globalThis.__piDebugSessions = new Map();
  return globalThis.__piDebugSessions;
}

function parseInspectUrl(text: string): string | null {
  const m = text.match(/Debugger listening on (ws:\/\/\S+)/);
  return m?.[1] ?? null;
}

function framesFromPaused(params: unknown): DebugFrame[] {
  const p = params as { callFrames?: Array<{
    callFrameId: string;
    functionName: string;
    url: string;
    location?: { lineNumber?: number; columnNumber?: number };
  }> };
  return (p.callFrames ?? []).map((f) => ({
    callFrameId: f.callFrameId,
    functionName: f.functionName || "(anonymous)",
    url: f.url,
    lineNumber: (f.location?.lineNumber ?? 0) + 1,
    columnNumber: (f.location?.columnNumber ?? 0) + 1,
  }));
}

export async function debugLaunch(
  cwd: string,
  command: string,
  options?: { breakOnStart?: boolean },
): Promise<DebugSessionInfo> {
  const id = randomBytes(4).toString("hex");
  const breakOnStart = options?.breakOnStart !== false;
  // Prefer node entry: if command looks like a script path, wrap it.
  let shell = command.trim();
  if (!shell) throw new Error("command is required");
  const inspectFlag = breakOnStart ? "--inspect-brk=0" : "--inspect=0";
  // If user passed a .js/.ts/.mjs file, run with node
  if (/^[^|&;]+?\.(c?js|mjs|ts)\b/.test(shell) && !shell.startsWith("node ")) {
    shell = `node ${inspectFlag} ${shell}`;
  } else if (shell.startsWith("node ")) {
    shell = shell.replace(/^node\s+/, `node ${inspectFlag} `);
  } else {
    // generic: NODE_OPTIONS
    shell = `NODE_OPTIONS='${inspectFlag}' ${shell}`;
  }

  const child = spawn("bash", ["-lc", shell], {
    cwd: resolve(cwd),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const live: LiveSession = {
    info: {
      id,
      cwd: resolve(cwd),
      command: shell,
      inspectUrl: "",
      pid: child.pid ?? null,
      status: "starting",
    },
    child,
    conn: null,
    logs: [],
  };
  pool().set(id, live);

  const waitUrl = new Promise<string>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for inspector URL")), 15_000);
    const onChunk = (buf: Buffer) => {
      const text = buf.toString("utf8");
      live.logs.push(text);
      if (live.logs.length > 200) live.logs.shift();
      const url = parseInspectUrl(text);
      if (url) {
        clearTimeout(timer);
        resolvePromise(url);
      }
    };
    child.stderr.on("data", onChunk);
    child.stdout.on("data", onChunk);
    child.on("exit", (code) => {
      live.info.status = "exited";
      live.info.exitCode = code;
      clearTimeout(timer);
    });
  });

  try {
    const inspectUrl = await waitUrl;
    live.info.inspectUrl = inspectUrl;
    const conn = new InspectorConnection();
    live.conn = conn;
    conn.onPaused = (params) => {
      live.info.status = "paused";
      live.info.lastStop = {
        reason: (params as { reason?: string }).reason,
        callFrames: framesFromPaused(params),
      };
    };
    conn.onResumed = () => {
      live.info.status = "running";
    };
    conn.onExit = () => {
      if (live.info.status !== "exited") live.info.status = "exited";
    };
    await conn.connect(inspectUrl);
    if (breakOnStart) {
      try {
        const paused = await conn.waitForPaused(12_000);
        live.info.status = "paused";
        live.info.lastStop = {
          reason: (paused as { reason?: string }).reason,
          callFrames: framesFromPaused(paused),
        };
      } catch {
        // Still mark paused-ish; stack may populate on next pause event.
        live.info.status = "paused";
        if (conn.lastPausedParams) {
          live.info.lastStop = {
            reason: (conn.lastPausedParams as { reason?: string }).reason,
            callFrames: framesFromPaused(conn.lastPausedParams),
          };
        }
      }
    } else {
      live.info.status = "running";
    }
    return { ...live.info };
  } catch (error) {
    live.info.status = "error";
    live.info.error = error instanceof Error ? error.message : String(error);
    try { child.kill(); } catch { /* ignore */ }
    throw error;
  }
}

export function debugList(): DebugSessionInfo[] {
  return [...pool().values()].map((s) => ({ ...s.info }));
}

export function debugGet(id: string): LiveSession | null {
  return pool().get(id) ?? null;
}

export async function debugContinue(id: string): Promise<DebugSessionInfo> {
  const s = pool().get(id);
  if (!s?.conn) throw new Error("Debug session not found");
  await s.conn.resume();
  s.info.status = "running";
  return { ...s.info };
}

export async function debugPause(id: string): Promise<DebugSessionInfo> {
  const s = pool().get(id);
  if (!s?.conn) throw new Error("Debug session not found");
  await s.conn.pause();
  return { ...s.info };
}

export async function debugBreakpoint(id: string, file: string, line: number): Promise<{ breakpointId: string; info: DebugSessionInfo }> {
  const s = pool().get(id);
  if (!s?.conn) throw new Error("Debug session not found");
  const abs = resolve(s.info.cwd, file);
  const breakpointId = await s.conn.setBreakpointByUrl(abs, line);
  return { breakpointId, info: { ...s.info } };
}

export async function debugEvaluate(id: string, expression: string, frameIndex = 0): Promise<string> {
  const s = pool().get(id);
  if (!s?.conn) throw new Error("Debug session not found");
  const frame = s.info.lastStop?.callFrames?.[frameIndex];
  return s.conn.evaluate(expression, frame?.callFrameId);
}

export async function debugStack(id: string): Promise<DebugFrame[]> {
  const s = pool().get(id);
  if (!s) throw new Error("Debug session not found");
  if (s.info.lastStop?.callFrames?.length) return s.info.lastStop.callFrames;
  // refresh from last paused params if any
  if (s.conn?.lastPausedParams) {
    const frames = framesFromPaused(s.conn.lastPausedParams);
    s.info.lastStop = {
      reason: (s.conn.lastPausedParams as { reason?: string }).reason,
      callFrames: frames,
    };
    return frames;
  }
  return [];
}

export async function debugStop(id: string): Promise<void> {
  const s = pool().get(id);
  if (!s) return;
  try { s.conn?.close(); } catch { /* ignore */ }
  try { s.child?.kill("SIGTERM"); } catch { /* ignore */ }
  s.info.status = "exited";
  pool().delete(id);
}

export function debugLogs(id: string): string {
  const s = pool().get(id);
  if (!s) throw new Error("Debug session not found");
  return s.logs.join("");
}


