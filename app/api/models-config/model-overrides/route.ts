import { NextResponse } from "next/server";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";
import { refreshBuiltinProviderModels, writeBuiltinModelOverride } from "@/lib/builtin-provider-models";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateUtilityModelRuntimes } from "@/lib/utility-model";

export const dynamic = "force-dynamic";

/**
 * PUT { provider, modelId, thinkingLevelMap?, reasoning?, contextWindow?, maxTokens? }
 *
 * Owner for built-in model field overrides.
 * Invariant: official runtime thinkingLevelMap locks user thinkingLevelMap writes.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json() as {
      provider?: unknown;
      modelId?: unknown;
      thinkingLevelMap?: unknown;
      reasoning?: unknown;
      contextWindow?: unknown;
      maxTokens?: unknown;
    };
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!provider || !modelId) {
      return NextResponse.json({ error: "provider and modelId are required" }, { status: 400 });
    }

    const modelRuntime = await createConfiguredModelRuntime();
    if (!modelRuntime.getProvider(provider)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
    }
    await refreshBuiltinProviderModels(modelRuntime, provider);
    const runtimeModel = modelRuntime.getModel(provider, modelId);
    if (!runtimeModel) {
      return NextResponse.json({ error: `Unknown model: ${provider}/${modelId}` }, { status: 404 });
    }

    const result = writeBuiltinModelOverride(provider, modelId, runtimeModel, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    invalidateModelsCache();
    invalidateUtilityModelRuntimes();
    return NextResponse.json({ success: true, override: result.override });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
