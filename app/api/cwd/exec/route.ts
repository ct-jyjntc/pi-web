import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import {
  allowFileRoot,
  getAllowedFileRoots,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 2 * 1024 * 1024;

function buildExecEnv(): NodeJS.ProcessEnv {
  const basePath = process.env.PATH ?? "";
  const extras = process.platform === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const merged = [...extras, ...basePath.split(path.delimiter).filter(Boolean)];
  const seen = new Set<string>();
  const pathParts: string[] = [];
  for (const part of merged) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    pathParts.push(part);
  }
  return {
    ...process.env,
    PATH: pathParts.join(path.delimiter),
    FORCE_COLOR: "0",
    TERM: process.env.TERM || "dumb",
    LANG: process.env.LANG || "en_US.UTF-8",
  };
}

function resolveShell(): { bin: string; args: string[] } {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return { bin: comspec, args: ["/d", "/s", "/c"] };
  }
  const preferred = process.env.SHELL || "/bin/zsh";
  const candidates = [preferred, "/bin/zsh", "/bin/bash", "/bin/sh"];
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) {
        // -l: login shell so macOS/Electron picks up user PATH profiles more often
        // -c: run the provided command string
        return { bin, args: ["-lc"] };
      }
    } catch {
      // try next
    }
  }
  return { bin: "/bin/sh", args: ["-c"] };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; command?: string };
    const cwd = body.cwd?.trim() ?? "";
    const command = body.command?.trim() ?? "";

    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!command) {
      return NextResponse.json({ error: "command required" }, { status: 400 });
    }
    // Refuse interactive shells / control operators that need a real PTY for now.
    if (/[\n\r]/.test(command)) {
      return NextResponse.json({ error: "Multi-line commands are not supported yet" }, { status: 400 });
    }

    try {
      const stat = fs.statSync(cwd);
      if (!stat.isDirectory()) {
        return NextResponse.json({ error: "Not a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    // Existing session/project roots are allow-listed; also accept a path that
    // already passed cwd/validate (stored via allowFileRoot) in this process.
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      // Last chance: if the directory exists and is under home or a known session
      // parent, still deny. Surface a clearer message for the UI.
      return NextResponse.json({
        error: "Access denied for this working directory. Open the project from the sidebar first.",
      }, { status: 403 });
    }
    // Keep the cwd warm in the allow-list (helps subsequent file/tool calls).
    allowFileRoot(cwd);

    const shell = resolveShell();
    try {
      const { stdout, stderr } = await execFileAsync(shell.bin, [...shell.args, command], {
        cwd,
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: buildExecEnv(),
        windowsHide: true,
      });
      return NextResponse.json({
        ok: true,
        stdout: Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout ?? ""),
        stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? ""),
        code: 0,
      });
    } catch (error) {
      const err = error as {
        killed?: boolean;
        code?: number | string;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };
      if (err.killed) {
        return NextResponse.json({ error: "Command timed out" }, { status: 408 });
      }
      const out = err.stdout;
      const errOut = err.stderr;
      const stdout = Buffer.isBuffer(out) ? out.toString("utf8") : String(out ?? "");
      const stderr = Buffer.isBuffer(errOut) ? errOut.toString("utf8") : String(errOut ?? "");
      return NextResponse.json({
        ok: false,
        stdout,
        stderr: stderr || err.message || "Command failed",
        code: typeof err.code === "number" ? err.code : 1,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
