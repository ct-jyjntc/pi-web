import { NextResponse } from "next/server";
import { getPermissionMode, setPermissionMode, type PermissionMode } from "@/lib/permission-mode";

export const dynamic = "force-dynamic";

// GET /api/permissions
export async function GET() {
  try {
    return NextResponse.json(getPermissionMode());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// POST /api/permissions  body: { mode: "ask" | "full" }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { mode?: string };
    const mode = body.mode === "full" ? "full" : body.mode === "ask" ? "ask" : null;
    if (!mode) {
      return NextResponse.json({ error: 'mode must be "ask" or "full"' }, { status: 400 });
    }
    const state = setPermissionMode(mode as PermissionMode);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
