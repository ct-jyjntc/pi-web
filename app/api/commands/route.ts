import { NextRequest, NextResponse } from "next/server";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { listUserCommands, renderCommandBody, type UserCommand } from "@/lib/commands";

export const dynamic = "force-dynamic";

/**
 * GET /api/commands?cwd=  → { commands: UserCommand[] }
 * POST /api/commands { cwd, name, args } → { body } (rendered, for preview).
 */
export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    return NextResponse.json({ commands: listUserCommands(cwd) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      cwd?: string;
      name?: string;
      args?: Record<string, string>;
    } | null;
    const cwd = body?.cwd?.trim() ?? "";
    const name = body?.name?.trim() ?? "";
    if (!cwd || !name) {
      return NextResponse.json({ error: "cwd and name are required" }, { status: 400 });
    }
    const command = listUserCommands(cwd).find((c: UserCommand) => c.name === name);
    if (!command) {
      return NextResponse.json({ error: `Command not found: ${name}` }, { status: 404 });
    }
    const values: Record<string, string> = {};
    for (const arg of command.args) {
      const value = body?.args?.[arg];
      if (typeof value === "string" && value.trim()) values[arg] = value;
    }
    return NextResponse.json({ body: renderCommandBody(command.body, values) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
