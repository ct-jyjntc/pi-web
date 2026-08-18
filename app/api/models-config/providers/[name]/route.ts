import { NextResponse } from "next/server";
import {
  upsertProvider,
  deleteProviderEntry,
  invalidateAfterModelsChange,
} from "@/lib/models-config-json";

export const dynamic = "force-dynamic";

/**
 * Per-provider atomic save endpoint. One provider = one PATCH/DELETE, so the
 * settings UI can save provider edits on blur without writing half-edited
 * baseUrl/apiKey into the shared models.json that startRpcSession reads live.
 * Body shape (PATCH): the full provider entry object.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "provider entry object is required" }, { status: 400 });
    }
    const result = upsertProvider(name, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    await invalidateAfterModelsChange();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const result = deleteProviderEntry(name);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    await invalidateAfterModelsChange();
    return NextResponse.json({ success: true, existed: result.existed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
