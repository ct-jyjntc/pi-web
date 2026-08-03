/**
 * POST /api/project-init — scan cwd and create/improve AGENTS.md (/init).
 */
import { NextResponse } from "next/server";
import { resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { runProjectInit } from "@/lib/project-init";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      cwd?: string;
      dryRun?: boolean;
      focus?: string;
      heuristicOnly?: boolean;
    };
    const cwdRaw = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwdRaw) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const cwd = resolve(cwdRaw);
    // Make the project browsable after init (same as other cwd entry points).
    try {
      allowFileRoot(cwd);
    } catch {
      // allowFileRoot may throw for invalid paths; runProjectInit will re-check.
    }

    const result = await runProjectInit(cwd, {
      dryRun: body.dryRun === true,
      focus: typeof body.focus === "string" ? body.focus : undefined,
      heuristicOnly: body.heuristicOnly === true,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
