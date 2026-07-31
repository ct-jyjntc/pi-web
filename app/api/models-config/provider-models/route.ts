import { NextResponse } from "next/server";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";
import {
  getDisabledModelRefs,
  setBuiltinModelDisabled,
} from "@/lib/disabled-models";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateUtilityModelRuntimes } from "@/lib/utility-model";

export const dynamic = "force-dynamic";

type ProviderModelRow = {
  id: string;
  name: string;
  reasoning: boolean;
  supportsImage: boolean;
  disabled: boolean;
};

/**
 * GET ?provider=id
 * List runtime models for a built-in API-key / OAuth provider with disabled flags.
 */
export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider")?.trim() ?? "";
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  try {
    const modelRuntime = await createConfiguredModelRuntime();
    const def = modelRuntime.getProvider(provider);
    if (!def) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
    }

    const disabled = getDisabledModelRefs();
    const models: ProviderModelRow[] = modelRuntime.getModels(provider).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      reasoning: !!m.reasoning,
      supportsImage: Array.isArray(m.input) && m.input.includes("image"),
      disabled: disabled.has(`${provider}/${m.id}`),
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      || a.id.localeCompare(b.id));

    const enabledCount = models.filter((m) => !m.disabled).length;
    return NextResponse.json({
      provider,
      displayName: def.name,
      modelCount: models.length,
      enabledCount,
      models,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * PATCH { provider, modelId, disabled }
 * Persist built-in model enable/disable without rewriting models.json catalogs.
 */
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

    const modelRuntime = await createConfiguredModelRuntime();
    if (!modelRuntime.getProvider(provider)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
    }
    if (!modelRuntime.getModel(provider, modelId)) {
      return NextResponse.json({ error: `Unknown model: ${provider}/${modelId}` }, { status: 404 });
    }

    const result = setBuiltinModelDisabled(provider, modelId, body.disabled);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    invalidateModelsCache();
    invalidateUtilityModelRuntimes();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
