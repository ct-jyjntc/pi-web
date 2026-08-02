import { NextRequest, NextResponse } from "next/server";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { runLeanReview } from "@/lib/lean-review";
import type { LeanIntensity } from "@/lib/web-settings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      sessionId?: string;
      intensity?: string;
      mode?: string;
      paths?: unknown;
      allowFullWorktree?: boolean;
    };
    const cwd = body.cwd?.trim() ?? "";
    const sessionId = body.sessionId?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const mode = body.mode === "manual" ? "manual" : "auto";
    let intensity: LeanIntensity | undefined;
    if (body.intensity === "soft" || body.intensity === "review" || body.intensity === "hard") {
      intensity = body.intensity;
    }
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean).slice(0, 40)
      : undefined;
    const result = await runLeanReview({
      cwd,
      sessionId,
      intensity,
      mode,
      paths,
      allowFullWorktree: body.allowFullWorktree === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
