import { NextResponse } from "next/server";
import {
  getBuiltinDisabledModelRefs,
  setBuiltinModelDisabled,
} from "@/lib/disabled-models";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

/**
 * Built-in (OAuth / API-key) model enable/disable denylist.
 * SDK-free on purpose: only reads/writes ~/.pi/agent/disabled-models.json so
 * toggles stay on the light runtime and feel instant like custom/free models.
 */

export async function GET() {
  const refs = [...getBuiltinDisabledModelRefs()].sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ disabled: refs });
}

/** PATCH { provider, modelId, disabled } */
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      provider?: unknown;
      modelId?: unknown;
      disabled?: unknown;
    };
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!provider || !modelId) {
      return NextResponse.json({ error: "provider and modelId are required" }, { status: 400 });
    }
    if (typeof body.disabled !== "boolean") {
      return NextResponse.json({ error: "disabled boolean is required" }, { status: 400 });
    }

    const result = setBuiltinModelDisabled(provider, modelId, body.disabled);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    invalidateModelsCache();
    try {
      const { invalidateUtilityModelRuntimes } = await import("@/lib/utility-model");
      invalidateUtilityModelRuntimes();
    } catch {
      // optional on light
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
