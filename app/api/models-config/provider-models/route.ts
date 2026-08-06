import { NextResponse } from "next/server";
import { getDisabledModelRefs } from "@/lib/disabled-models";
import {
  readBuiltinProviderModelsCache,
  writeBuiltinProviderModelsCache,
} from "@/lib/builtin-provider-models-cache";

export const dynamic = "force-dynamic";

/**
 * Built-in provider model list.
 *
 * Default (no query): **cache-only**, SDK-free — light runtime.
 * `?fresh=1`: ModelRuntime network refresh for this provider, then write cache — heavy.
 *
 * Enable/disable stays on `/api/models-config/disabled-models` (light).
 * Cache stores catalog rows; disabled flags are re-applied from denylist on read.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider")?.trim() ?? "";
  const force = url.searchParams.get("fresh") === "1";
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  // ── Cache path (light): never import ModelRuntime ─────────────────────────
  if (!force) {
    const cached = readBuiltinProviderModelsCache(provider);
    if (!cached) {
      return NextResponse.json({
        provider,
        displayName: provider,
        modelCount: 0,
        enabledCount: 0,
        live: false,
        degraded: true,
        cached: false,
        models: [],
      });
    }
    const models = cached.models;
    return NextResponse.json({
      provider,
      displayName: cached.displayName ?? provider,
      modelCount: models.length,
      enabledCount: models.filter((m) => !m.disabled).length,
      live: false,
      degraded: false,
      cached: true,
      updatedAt: cached.updatedAt,
      models,
    });
  }

  // ── Fresh path (heavy): SDK + optional network refresh ────────────────────
  try {
    const { createConfiguredModelRuntime } = await import("@/lib/model-runtime");
    const { projectBuiltinProviderModel, refreshBuiltinProviderModels } = await import(
      "@/lib/builtin-provider-models"
    );

    const modelRuntime = await createConfiguredModelRuntime();
    const def = modelRuntime.getProvider(provider);
    if (!def) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
    }

    const live = await refreshBuiltinProviderModels(modelRuntime, provider);
    const disabled = getDisabledModelRefs();
    const models = modelRuntime
      .getModels(provider)
      .map((m) => projectBuiltinProviderModel(provider, m, disabled.has(`${provider}/${m.id}`)))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) ||
          a.id.localeCompare(b.id),
      );

    writeBuiltinProviderModelsCache(provider, {
      displayName: def.name,
      models,
    });

    const enabledCount = models.filter((m) => !m.disabled).length;
    return NextResponse.json({
      provider,
      displayName: def.name,
      modelCount: models.length,
      enabledCount,
      live,
      degraded: !live,
      cached: false,
      updatedAt: Date.now(),
      models,
    });
  } catch (error) {
    // Soft-fail: if live refresh fails but cache exists, serve cache.
    const cached = readBuiltinProviderModelsCache(provider);
    if (cached && cached.models.length > 0) {
      return NextResponse.json({
        provider,
        displayName: cached.displayName ?? provider,
        modelCount: cached.models.length,
        enabledCount: cached.models.filter((m) => !m.disabled).length,
        live: false,
        degraded: true,
        cached: true,
        updatedAt: cached.updatedAt,
        models: cached.models,
        warning: String(error),
      });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** @deprecated Prefer PATCH /api/models-config/disabled-models (light). Kept for old clients. */
export async function PATCH(req: Request) {
  const { PATCH: disabledPatch } = await import("../disabled-models/route");
  return disabledPatch(req);
}
