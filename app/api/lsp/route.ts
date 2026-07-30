import { NextRequest, NextResponse } from "next/server";
import { formatLspHealthReport, getLspHealth } from "@/lib/lsp-health";

/**
 * GET /api/lsp?cwd=/path
 * Language server discovery + install hints (no server spawn).
 */
export async function GET(req: NextRequest) {
  try {
    const cwd = req.nextUrl.searchParams.get("cwd");
    const health = getLspHealth(cwd);
    return NextResponse.json({
      ok: true,
      ...health,
      report: formatLspHealthReport(health),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
