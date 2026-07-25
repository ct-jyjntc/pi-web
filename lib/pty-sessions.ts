import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { IPty } from "node-pty";
import { allowFileRoot, getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "./file-access";

export type PtyEvent =
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "ready"; pid: number; shell: string; cwd: string; cols: number; rows: number };

type PtyListener = (event: PtyEvent) => void;

interface PtySession {
  id: string;
  cwd: string;
  shell: string;
  pty: IPty;
  cols: number;
  rows: number;
  createdAt: number;
  lastActiveAt: number;
  exited: boolean;
  listeners: Set<PtyListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __piPtySessions: Map<string, PtySession> | undefined;
  // eslint-disable-next-line no-var
  var __piPtyModule: typeof import("node-pty") | null | undefined;
}

const IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 12;

function sessions(): Map<string, PtySession> {
  if (!globalThis.__piPtySessions) globalThis.__piPtySessions = new Map();
  return globalThis.__piPtySessions;
}

function ensureSpawnHelperExecutable(): void {
  // npm/packaging can drop the +x bit on node-pty's macOS spawn-helper, which
  // then fails with the opaque "posix_spawnp failed" error.
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
        // u+x / g+x / o+x as needed
        if ((mode & 0o111) !== 0o111) {
          fs.chmodSync(helper, mode | 0o755);
        }
      } catch {
        // best-effort
      }
    }
  } catch {
    // ignore resolve failures — spawn will surface a clearer error later
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

function buildEnv(cwd: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
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
  // Avoid leaking Electron-as-node into child shells.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function touch(session: PtySession): void {
  session.lastActiveAt = Date.now();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    destroyPtySession(session.id, "idle timeout");
  }, IDLE_MS);
  // Don't keep the process alive solely for idle timers.
  session.idleTimer.unref?.();
}

function emit(session: PtySession, event: PtyEvent): void {
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      // ignore subscriber errors
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

export async function createPtySession(options: {
  cwd: string;
  cols?: number;
  rows?: number;
}): Promise<{ id: string; pid: number; shell: string; cwd: string; cols: number; rows: number }> {
  const cwd = await assertPtyCwdAllowed(options.cwd);
  const cols = Math.max(20, Math.min(400, Math.floor(options.cols ?? 80)));
  const rows = Math.max(5, Math.min(200, Math.floor(options.rows ?? 24)));
  const pty = await loadPtyModule();
  const shell = resolveShell();
  pruneIfNeeded();

  const id = randomBytes(8).toString("hex");
  let term: IPty;
  try {
    const env = buildEnv(cwd);
    term = process.platform === "win32"
      ? pty.spawn(shell, [], {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env,
          useConpty: true,
        })
      : pty.spawn(shell, ["-l"], {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env,
        });
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
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    exited: false,
    listeners: new Set(),
    idleTimer: null,
  };

  term.onData((data) => {
    touch(session);
    emit(session, { type: "data", data });
  });
  term.onExit(({ exitCode, signal }) => {
    session.exited = true;
    emit(session, { type: "exit", exitCode, signal: signal ?? undefined });
    // Keep the record briefly so late subscribers see the exit, then drop.
    setTimeout(() => destroyPtySession(id), 5_000).unref?.();
  });

  sessions().set(id, session);
  touch(session);
  return { id, pid: term.pid, shell, cwd, cols, rows };
}

export function getPtySession(id: string): PtySession | null {
  return sessions().get(id) ?? null;
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
  // Immediate ready event for late joiners.
  listener({
    type: "ready",
    pid: session.pty.pid,
    shell: session.shell,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
  });
  if (session.exited) {
    listener({ type: "exit", exitCode: 0 });
  }
  return () => {
    session.listeners.delete(listener);
  };
}

export function destroyPtySession(id: string, _reason?: string): void {
  const session = sessions().get(id);
  if (!session) return;
  sessions().delete(id);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.listeners.clear();
  try {
    if (!session.exited) session.pty.kill();
  } catch {
    // already dead
  }
}
