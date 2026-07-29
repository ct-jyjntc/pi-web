import { NextRequest, NextResponse } from "next/server";
import { resolve } from "path";
import { allowFileRoot, isWindowsAbsolutePath } from "@/lib/file-access";
import {
  deleteMemoryFact,
  listMemoryFacts,
  parseProjectMemorySettings,
  reflectMemoryHeuristic,
  retainMemoryFact,
} from "@/lib/project-memory";
import { runMemoryReflect } from "@/lib/memory-reflect";
import { readWebSettings } from "@/lib/web-settings";

export const dynamic = "force-dynamic";

function pickCwd(raw: string | null | undefined): string | null {
  const cwd = raw?.trim();
  if (!cwd) return null;
  if (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd)) return null;
  return resolve(cwd);
}

export async function GET(req: NextRequest) {
  try {
    const cwd = pickCwd(req.nextUrl.searchParams.get("cwd"));
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    allowFileRoot(cwd);
    const settings = parseProjectMemorySettings(readWebSettings().projectMemory);
    const facts = listMemoryFacts(cwd);
    return NextResponse.json({ settings, facts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      cwd?: string;
      action?: string;
      text?: string;
      tags?: string[];
      importance?: number;
      focus?: string;
      limit?: number;
      useModel?: boolean;
      retain?: boolean;
      heuristicOnly?: boolean;
    };
    const cwd = pickCwd(body.cwd);
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    allowFileRoot(cwd);
    const settings = parseProjectMemorySettings(readWebSettings().projectMemory);
    if (!settings.enabled) {
      return NextResponse.json({ error: "Project memory is disabled" }, { status: 400 });
    }

    // Reflect synthesis (omp-lite)
    if (body.action === "reflect") {
      const heuristicOnly = body.heuristicOnly === true || body.useModel === false;
      const reflection = heuristicOnly
        ? reflectMemoryHeuristic(cwd, { focus: body.focus, limit: body.limit })
        : await runMemoryReflect(cwd, {
            focus: body.focus,
            limit: body.limit,
            useModel: true,
            retain: body.retain === true,
          });
      return NextResponse.json({ ok: true, reflection });
    }

    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "text is required (or action=reflect)" }, { status: 400 });
    }
    const fact = retainMemoryFact(cwd, body.text, {
      tags: body.tags,
      importance: body.importance,
      source: "user",
      settings,
    });
    return NextResponse.json({ ok: true, fact });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /secret|empty/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { cwd?: string; id?: string };
    const cwd = pickCwd(body.cwd);
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    allowFileRoot(cwd);
    const removed = deleteMemoryFact(cwd, body.id.trim());
    if (!removed) return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
