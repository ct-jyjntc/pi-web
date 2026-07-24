import { exec } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";

const execAsync = promisify(exec);
const EXEC_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 2 * 1024 * 1024;

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

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    try {
      const stat = fs.statSync(cwd);
      if (!stat.isDirectory()) {
        return NextResponse.json({ error: "Not a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/zsh",
      });
      return NextResponse.json({
        ok: true,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: 0,
      });
    } catch (error) {
      const err = error as {
        killed?: boolean;
        code?: number | string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      if (err.killed) {
        return NextResponse.json({ error: "Command timed out" }, { status: 408 });
      }
      return NextResponse.json({
        ok: false,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message ?? "Command failed",
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
