import { NextResponse } from "next/server";
import {
  readBuiltinProviderModelsCache,
} from "@/lib/builtin-provider-models-cache";

export const dynamic = "force-dynamic";

/**
 * Built-in provider model list.
 *
 * Default (no query): **cache-only**, SDK-free — light runtime.
 * `?fresh=1`: materialize ONE provider from local ModelRuntime (static + models-store),
 * then write cache — heavy. Never fans out to pi.dev remote catalogs.
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

  // ── Fresh path (heavy): one provider, local catalog only ──────────────────
  try {
    const { materializeBuiltinProviderCatalog } = await import(
      "@/lib/builtin-provider-models-fresh"
    );
    const result = await materializeBuiltinProviderCatalog(provider, {
      signal: req.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ error: "aborted" }, { status: 499 });
    }
    // Soft-fail: if materialize fails but cache exists, serve cache.
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
