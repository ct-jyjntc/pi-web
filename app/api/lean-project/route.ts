import { NextRequest, NextResponse } from "next/server";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { readProjectLeanFile, writeProjectLeanOverride } from "@/lib/lean-project-file";
import { resolveLeanMode } from "@/lib/lean-settings";
import type { LeanIntensity, LeanModeSettings } from "@/lib/lean-mode-settings";
import { destroyIdleRpcSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

function absCwd(raw: string | null | undefined): string | null {
  const cwd = raw?.trim() ?? "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) return null;
  return cwd;
}

export async function GET(req: NextRequest) {
  try {
    const cwd = absCwd(req.nextUrl.searchParams.get("cwd"));
    if (!cwd) return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    const file = readProjectLeanFile(cwd);
    const effective = resolveLeanMode(cwd);
    return NextResponse.json({
      ok: true,
      path: file.path,
      override: file.override,
      effective,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      cwd?: string;
      clear?: boolean;
      leanMode?: Partial<LeanModeSettings>;
    };
    const cwd = absCwd(body.cwd);
    if (!cwd) return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });

    if (body.clear === true) {
      const result = writeProjectLeanOverride(cwd, null);
      let idleSessionsReset = 0;
      try {
        idleSessionsReset = await destroyIdleRpcSessions();
      } catch {
        // ignore
      }
      return NextResponse.json({
        ok: true,
        path: result.path,
        override: null,
        effective: resolveLeanMode(cwd),
        idleSessionsReset,
      });
    }

    const lm = body.leanMode ?? {};
    const partial: Partial<LeanModeSettings> = {};
    if (typeof lm.enabled === "boolean") partial.enabled = lm.enabled;
    if (lm.intensity === "soft" || lm.intensity === "review" || lm.intensity === "hard") {
      partial.intensity = lm.intensity as LeanIntensity;
    }
    if (typeof lm.reviewOnAgentEnd === "boolean") partial.reviewOnAgentEnd = lm.reviewOnAgentEnd;

    if (Object.keys(partial).length === 0) {
      return NextResponse.json({ error: "leanMode patch is empty" }, { status: 400 });
    }

    const result = writeProjectLeanOverride(cwd, partial);
    let idleSessionsReset = 0;
    try {
      idleSessionsReset = await destroyIdleRpcSessions();
    } catch {
      // ignore
    }
    return NextResponse.json({
      ok: true,
      path: result.path,
      override: result.leanMode,
      effective: resolveLeanMode(cwd),
      idleSessionsReset,
      note: "Project override saved. Idle agent sessions were reset so the next turn reloads policy.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
