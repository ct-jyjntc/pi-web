import { NextResponse } from "next/server";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";
import { getDisabledModelRefs } from "@/lib/disabled-models";
import { projectBuiltinProviderModel, refreshBuiltinProviderModels } from "@/lib/builtin-provider-models";

export const dynamic = "force-dynamic";

/**
 * Built-in provider model list (read only).
 *
 * Enable/disable is owned by `/api/models-config/disabled-models` (light, fs-only)
 * so toggles never wait on ModelRuntime / remote catalog refresh.
 *
 * Invariant: one refresh path; response always includes `live` (true if network
 * refresh succeeded). Soft-fail continues with static/last store when live=false.
 *
 * Performance: ModelRuntime.refresh({ allowNetwork: true }) refreshes *every*
 * dynamic provider, not just `?provider=`. Settings fires one request per
 * connected provider in parallel — N full-network refreshes would thrash.
 * Prefer the offline/store catalog from create(); only hit the network when
 * the provider catalog is empty or the client passes `?fresh=1`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider")?.trim() ?? "";
  const force = url.searchParams.get("fresh") === "1";
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  try {
    const modelRuntime = await createConfiguredModelRuntime();
    const def = modelRuntime.getProvider(provider);
    if (!def) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
    }

    const existing = modelRuntime.getModels(provider);
    let live = false;
    if (force || existing.length === 0) {
      live = await refreshBuiltinProviderModels(modelRuntime, provider);
    } else {
      // Store / static catalog already populated — skip the global network refresh
      // so parallel per-provider GETs stay independent and fast.
      live = true;
    }

    const disabled = getDisabledModelRefs();
    const models = modelRuntime.getModels(provider)
      .map((m) => projectBuiltinProviderModel(provider, m, disabled.has(`${provider}/${m.id}`)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        || a.id.localeCompare(b.id));

    const enabledCount = models.filter((m) => !m.disabled).length;
    return NextResponse.json({
      provider,
      displayName: def.name,
      modelCount: models.length,
      enabledCount,
      live,
      degraded: !live,
      models,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** @deprecated Prefer PATCH /api/models-config/disabled-models (light). Kept for old clients. */
export async function PATCH(req: Request) {
  const { PATCH: disabledPatch } = await import("../disabled-models/route");
  return disabledPatch(req);
}
