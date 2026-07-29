import { NextRequest, NextResponse } from "next/server";
import {
  debugBreakpoint,
  debugContinue,
  debugEvaluate,
  debugLaunch,
  debugList,
  debugLogs,
  debugPause,
  debugStack,
  debugStop,
} from "@/lib/node-inspector";
import { isWindowsAbsolutePath } from "@/lib/file-access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, sessions: debugList() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: string;
      cwd?: string;
      command?: string;
      id?: string;
      file?: string;
      line?: number;
      expression?: string;
      frameIndex?: number;
      breakOnStart?: boolean;
    };
    const action = body.action?.trim() ?? "";

    if (action === "launch") {
      const cwd = body.cwd?.trim() ?? "";
      if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
        return NextResponse.json({ error: "cwd must be absolute" }, { status: 400 });
      }
      const info = await debugLaunch(cwd, String(body.command ?? ""), {
        breakOnStart: body.breakOnStart !== false,
      });
      return NextResponse.json({ ok: true, session: info });
    }

    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    if (action === "continue") {
      return NextResponse.json({ ok: true, session: await debugContinue(id) });
    }
    if (action === "pause") {
      return NextResponse.json({ ok: true, session: await debugPause(id) });
    }
    if (action === "stop") {
      await debugStop(id);
      return NextResponse.json({ ok: true });
    }
    if (action === "stack") {
      return NextResponse.json({ ok: true, frames: await debugStack(id) });
    }
    if (action === "logs") {
      return NextResponse.json({ ok: true, logs: debugLogs(id) });
    }
    if (action === "evaluate") {
      const value = await debugEvaluate(id, String(body.expression ?? ""), Number(body.frameIndex ?? 0));
      return NextResponse.json({ ok: true, value });
    }
    if (action === "breakpoint") {
      const result = await debugBreakpoint(id, String(body.file ?? ""), Number(body.line));
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
