import { NextRequest, NextResponse } from "next/server";
import { githubAction, ghAvailable, resolveRepo } from "@/lib/github";

/**
 * GET /api/github?cwd=&action=status
 * Thin gh-backed GitHub status / read API for Settings or smoke tests.
 */
export async function GET(req: NextRequest) {
  try {
    const cwd = req.nextUrl.searchParams.get("cwd") || process.cwd();
    const action = req.nextUrl.searchParams.get("action") || "status";
    if (action === "status") {
      const gh = await ghAvailable(cwd);
      const repo = await resolveRepo(cwd);
      return NextResponse.json({ ok: true, gh, repo });
    }
    const number = req.nextUrl.searchParams.get("number");
    const result = await githubAction(cwd, action, {
      number: number ? Number(number) : undefined,
      part: req.nextUrl.searchParams.get("part") ?? undefined,
      query: req.nextUrl.searchParams.get("query") ?? undefined,
      ref: req.nextUrl.searchParams.get("ref") ?? undefined,
      limit: req.nextUrl.searchParams.get("limit")
        ? Number(req.nextUrl.searchParams.get("limit"))
        : undefined,
    });
    return NextResponse.json({
      ok: result.ok,
      text: result.text,
      details: result.details,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : process.cwd();
    const action = String(body.action ?? "status");
    const result = await githubAction(cwd, action, body);
    return NextResponse.json({
      ok: result.ok,
      text: result.text,
      details: result.details,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
