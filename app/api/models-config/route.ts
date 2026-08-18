import { NextResponse } from "next/server";
import {
  readModelsJson,
  writeModelsJson,
  normalizeModelsJson,
  invalidateAfterModelsChange,
} from "@/lib/models-config-json";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = readModelsJson();
  if (!result.ok) {
    // Do not hand the UI an empty config it can save over a corrupt file.
    return NextResponse.json(
      { error: `Failed to parse models.json: ${result.error}`, corrupt: true },
      { status: 500 },
    );
  }
  return NextResponse.json(result.data);
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    writeModelsJson(normalizeModelsJson(body));
    await invalidateAfterModelsChange();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
