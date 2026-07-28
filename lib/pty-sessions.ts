import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { IPty } from "node-pty";
import { allowFileRoot, getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "./file-access";

export type PtySource = "user" | "agent";

export type PtyEvent =
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "ready"; pid: number; shell: string; cwd: string; cols: number; rows: number; source: PtySource; command?: string; title?: string };

export type PtySessionInfo = {
  id: string;
  cwd: string;
  shell: string;
  pid: number;
  cols: number;
  rows: number;
  source: PtySource;
  command?: string;
  title?: string;
  agentSessionId?: string;
  createdAt: number;
  lastActiveAt: number;
  exited: boolean;
  exitCode?: number;
  /** When false, hidden from Terminal UI (short agent commands). */
  published: boolean;
};

type PtyListener = (event: PtyEvent) => void;
type RegistryListener = (event: { type: "upsert" | "remove"; session?: PtySessionInfo; id?: string }) => void;

interface PtySession {
  id: string;
  cwd: string;
  shell: string;
  pty: IPty;
  cols: number;
  rows: number;
  source: PtySource;
  command?: string;
  title?: string;
  agentSessionId?: string;
  createdAt: number;
  lastActiveAt: number;
  exited: boolean;
  exitCode?: number;
  published: boolean;
  publishTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<PtyListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  history: string[];
  historyBytes: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __piPtySessions: Map<string, PtySession> | undefined;
  // eslint-disable-next-line no-var
  var __piPtyModule: typeof import("node-pty") | null | undefined;
  // eslint-disable-next-line no-var
  var __piPtyRegistryListeners: Set<RegistryListener> | undefined;
}

const IDLE_MS = 30 * 60 * 1000;
const AGENT_EXIT_KEEP_MS = 30 * 60 * 1000;
const USER_EXIT_KEEP_MS = 5_000;
const MAX_SESSIONS = 12;
const MAX_HISTORY_BYTES = 256 * 1024;

function sessions(): Map<string, PtySession> {
  if (!globalThis.__piPtySessions) globalThis.__piPtySessions = new Map();
  return globalThis.__piPtySessions;
}

function registryListeners(): Set<RegistryListener> {
  if (!globalThis.__piPtyRegistryListeners) globalThis.__piPtyRegistryListeners = new Set();
  return globalThis.__piPtyRegistryListeners;
}

function ensureSpawnHelperExecutable(): void {
  if (process.platform === "win32") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require.resolve("node-pty/package.json");
    const root = path.dirname(resolved);
    const candidates = [
      path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
      path.join(root, "build", "Release", "spawn-helper"),
      path.join(root, "lib", "spawn-helper"),
    ];
    for (const helper of candidates) {
      try {
        if (!fs.existsSync(helper)) continue;
        const mode = fs.statSync(helper).mode;
        if ((mode & 0o111) !== 0o111) {
          fs.chmodSync(helper, mode | 0o755);
        }
      } catch {
        // best-effort
      }
    }
  } catch {
    // ignore
  }
}

export async function loadPtyModule(): Promise<typeof import("node-pty")> {
  if (globalThis.__piPtyModule) return globalThis.__piPtyModule;
  if (globalThis.__piPtyModule === null) {
    throw new Error("node-pty is unavailable in this environment");
  }
  try {
    ensureSpawnHelperExecutable();
    const mod = await import("node-pty");
    globalThis.__piPtyModule = mod;
    return mod;
  } catch (error) {
    globalThis.__piPtyModule = null;
    throw new Error(
      `Failed to load node-pty: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  const preferred = process.env.SHELL || "/bin/zsh";
  for (const candidate of [preferred, "/bin/zsh", "/bin/bash", "/bin/sh"]) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // continue
    }
  }
  return "/bin/sh";
}

function shouldUseLoginShell(): boolean {
  try {
    // Lazy require to avoid circular deps with web-settings in edge cases.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readWebSettings } = require("./web-settings") as typeof import("./web-settings");
    return readWebSettings().inheritTerminalEnv !== false;
  } catch {
    return true;
  }
}

function buildEnv(cwd: string, extra?: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === "string") env[key] = value;
      else if (value === undefined) delete env[key];
    }
  }
  const extras = process.platform === "win32"
    ? []
    : [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        path.join(os.homedir(), ".local/bin"),
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ];
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const current = env[pathKey] ?? "";
  const parts = [
    ...extras,
    ...current.split(path.delimiter).filter(Boolean),
  ];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    merged.push(part);
  }
  env[pathKey] = merged.join(path.delimiter);
  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";
  env.LANG = env.LANG || "en_US.UTF-8";
  env.PWD = cwd;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function toInfo(session: PtySession): PtySessionInfo {
  return {
    id: session.id,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pty.pid,
    cols: session.cols,
    rows: session.rows,
    source: session.source,
    command: session.command,
    title: session.title,
    agentSessionId: session.agentSessionId,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    exited: session.exited,
    exitCode: session.exitCode,
    published: session.published,
  };
}

function emitRegistry(event: { type: "upsert" | "remove"; session?: PtySessionInfo; id?: string }): void {
  for (const listener of registryListeners()) {
    try {
      listener(event);
    } catch {
      // ignore
    }
  }
}

function touch(session: PtySession): void {
  session.lastActiveAt = Date.now();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    destroyPtySession(session.id, "idle timeout");
  }, IDLE_MS);
  session.idleTimer.unref?.();
}

function pushHistory(session: PtySession, chunk: string): void {
  if (!chunk) return;
  session.history.push(chunk);
  session.historyBytes += chunk.length;
  while (session.historyBytes > MAX_HISTORY_BYTES && session.history.length > 1) {
    const removed = session.history.shift();
    if (removed) session.historyBytes -= removed.length;
  }
}

function emit(session: PtySession, event: PtyEvent): void {
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      // ignore
    }
  }
}

function pruneIfNeeded(): void {
  const map = sessions();
  if (map.size < MAX_SESSIONS) return;
  const ordered = [...map.values()].sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  while (map.size >= MAX_SESSIONS && ordered.length) {
    const oldest = ordered.shift();
    if (oldest) destroyPtySession(oldest.id, "session limit");
  }
}

export async function assertPtyCwdAllowed(cwd: string): Promise<string> {
  const trimmed = cwd.trim();
  if (!trimmed || (!trimmed.startsWith("/") && !isWindowsAbsolutePath(trimmed))) {
    throw Object.assign(new Error("cwd must be an absolute path"), { status: 400 });
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(trimmed);
  } catch {
    throw Object.assign(new Error("Directory not found"), { status: 404 });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw Object.assign(new Error("Directory not found"), { status: 404 });
  }
  if (!stat.isDirectory()) {
    throw Object.assign(new Error("Not a directory"), { status: 400 });
  }
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(resolved, roots)) {
    throw Object.assign(
      new Error("Access denied for this working directory. Open the project from the sidebar first."),
      { status: 403 },
    );
  }
  allowFileRoot(resolved);
  return resolved;
}

function titleFromCommand(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 36) return oneLine;
  return `${oneLine.slice(0, 33)}…`;
}

export async function createPtySession(options: {
  cwd: string;
  cols?: number;
  rows?: number;
  /** When set, run this command in the PTY and exit when it finishes (agent bash). */
  command?: string;
  source?: PtySource;
  agentSessionId?: string;
  title?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Whether Terminal UI should list this session immediately.
   * - true: show now (user shells / known long-running agent cmds)
   * - false: hidden until publishPtySession() (short agent cmds stay hidden)
   * - "delayed": publish after publishAfterMs if still running
   */
  publish?: boolean | "delayed";
  publishAfterMs?: number;
}): Promise<PtySessionInfo> {
  const cwd = await assertPtyCwdAllowed(options.cwd);
  const cols = Math.max(20, Math.min(400, Math.floor(options.cols ?? 80)));
  const rows = Math.max(5, Math.min(200, Math.floor(options.rows ?? 24)));
  const pty = await loadPtyModule();
  const shell = resolveShell();
  const source: PtySource = options.source ?? (options.command ? "agent" : "user");
  const command = options.command?.trim() || undefined;
  const title = options.title?.trim()
    || (command ? titleFromCommand(command) : undefined);
  const publishMode = options.publish ?? (source === "user" ? true : false);
  const publishedInitially = publishMode === true;
  pruneIfNeeded();

  const id = randomBytes(8).toString("hex");
  let term: IPty;
  try {
    const env = buildEnv(cwd, options.env);
    const login = shouldUseLoginShell();
    if (command) {
      // One-shot command in a real TTY so the Terminal UI can attach + intervene.
      term = process.platform === "win32"
        ? pty.spawn(shell, ["/d", "/s", "/c", command], {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env,
            useConpty: true,
          })
        : pty.spawn(shell, login ? ["-lc", command] : ["-c", command], {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env,
          });
    } else {
      term = process.platform === "win32"
        ? pty.spawn(shell, [], {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env,
            useConpty: true,
          })
        : pty.spawn(shell, login ? ["-l"] : [], {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env,
          });
    }
  } catch (error) {
    throw Object.assign(
      new Error(`Failed to spawn shell: ${error instanceof Error ? error.message : String(error)}`),
      { status: 500 },
    );
  }

  const session: PtySession = {
    id,
    cwd,
    shell,
    pty: term,
    cols,
    rows,
    source,
    command,
    title,
    agentSessionId: options.agentSessionId,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    exited: false,
    published: publishedInitially,
    publishTimer: null,
    listeners: new Set(),
    idleTimer: null,
    history: [],
    historyBytes: 0,
  };

  if (command) {
    const banner = `\r\n\x1b[90m$ ${command}\x1b[0m\r\n`;
    pushHistory(session, banner);
  }

  term.onData((data) => {
    touch(session);
    pushHistory(session, data);
    emit(session, { type: "data", data });
  });
  term.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode;
    if (session.publishTimer) {
      clearTimeout(session.publishTimer);
      session.publishTimer = null;
    }
    emit(session, { type: "exit", exitCode, signal: signal ?? undefined });
    // Only surface exit updates for sessions the UI already knows about.
    if (session.published) {
      emitRegistry({ type: "upsert", session: toInfo(session) });
    }
    const keepMs = session.source === "agent" ? AGENT_EXIT_KEEP_MS : USER_EXIT_KEEP_MS;
    setTimeout(() => destroyPtySession(id), keepMs).unref?.();
  });

  sessions().set(id, session);
  touch(session);

  if (publishMode === "delayed") {
    const delay = Math.max(250, Math.floor(options.publishAfterMs ?? 2000));
    session.publishTimer = setTimeout(() => {
      session.publishTimer = null;
      publishPtySession(id);
    }, delay);
    session.publishTimer.unref?.();
  }

  const info = toInfo(session);
  if (session.published) {
    emitRegistry({ type: "upsert", session: info });
  }
  return info;
}

/** Make a hidden agent PTY visible in the Terminal workspace. */
export function publishPtySession(id: string): PtySessionInfo | null {
  const session = sessions().get(id);
  if (!session || session.exited) return null;
  if (session.publishTimer) {
    clearTimeout(session.publishTimer);
    session.publishTimer = null;
  }
  if (session.published) return toInfo(session);
  session.published = true;
  const info = toInfo(session);
  emitRegistry({ type: "upsert", session: info });
  return info;
}

export function getPtySession(id: string): PtySession | null {
  return sessions().get(id) ?? null;
}

export function listPtySessions(filter?: {
  cwd?: string;
  source?: PtySource;
  agentSessionId?: string;
  /** Default true: only sessions shown in Terminal UI. */
  publishedOnly?: boolean;
}): PtySessionInfo[] {
  const cwd = filter?.cwd ? path.resolve(filter.cwd) : null;
  const publishedOnly = filter?.publishedOnly !== false;
  return [...sessions().values()]
    .filter((session) => {
      if (publishedOnly && !session.published) return false;
      if (cwd && path.resolve(session.cwd) !== cwd) return false;
      if (filter?.source && session.source !== filter.source) return false;
      if (filter?.agentSessionId && session.agentSessionId !== filter.agentSessionId) return false;
      return true;
    })
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toInfo);
}

export function writePtySession(id: string, data: string): void {
  const session = sessions().get(id);
  if (!session || session.exited) {
    throw Object.assign(new Error("Terminal session not found"), { status: 404 });
  }
  touch(session);
  session.pty.write(data);
}

export function resizePtySession(id: string, cols: number, rows: number): void {
  const session = sessions().get(id);
  if (!session || session.exited) {
    throw Object.assign(new Error("Terminal session not found"), { status: 404 });
  }
  const nextCols = Math.max(20, Math.min(400, Math.floor(cols)));
  const nextRows = Math.max(5, Math.min(200, Math.floor(rows)));
  session.cols = nextCols;
  session.rows = nextRows;
  touch(session);
  try {
    session.pty.resize(nextCols, nextRows);
  } catch {
    // ignore resize races near exit
  }
}

export function subscribePtySession(id: string, listener: PtyListener): () => void {
  const session = sessions().get(id);
  if (!session) {
    throw Object.assign(new Error("Terminal session not found"), { status: 404 });
  }
  session.listeners.add(listener);
  touch(session);
  listener({
    type: "ready",
    pid: session.pty.pid,
    shell: session.shell,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    source: session.source,
    command: session.command,
    title: session.title,
  });
  // Replay buffered output so late Terminal UI attaches still see AI commands.
  if (session.history.length > 0) {
    listener({ type: "data", data: session.history.join("") });
  }
  if (session.exited) {
    listener({ type: "exit", exitCode: session.exitCode ?? 0 });
  }
  return () => {
    session.listeners.delete(listener);
  };
}

export function subscribePtyRegistry(listener: RegistryListener): () => void {
  registryListeners().add(listener);
  return () => {
    registryListeners().delete(listener);
  };
}

export function destroyPtySession(id: string, _reason?: string): void {
  const session = sessions().get(id);
  if (!session) return;
  sessions().delete(id);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (session.publishTimer) clearTimeout(session.publishTimer);
  session.listeners.clear();
  if (session.published) {
    emitRegistry({ type: "remove", id });
  }
  try {
    if (!session.exited) session.pty.kill();
  } catch {
    // already dead
  }
}
