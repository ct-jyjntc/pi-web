import { NextResponse } from "next/server";
import {
  buildFreeModelEntries,
  getFreeProvider,
  type FreeProviderId,
} from "@/lib/free-providers";
import { loadModelsDevCatalogDetailed } from "@/lib/models-dev-catalog";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 8_000;

type OpenAiModelsResponse = {
  data?: Array<{ id?: unknown }>;
};

/**
 * Free provider model list.
 * Invariant: provider /models is required; models.dev enrichment is optional and
 * always reports catalogSource (never a silent empty catch in this route).
 */
export async function GET(req: Request) {
  const providerId = new URL(req.url).searchParams.get("provider") as FreeProviderId | null;
  const def = getFreeProvider(providerId);
  if (!def) {
    return NextResponse.json({ error: "Unknown free provider" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Provider /models and models.dev enrichment are independent. Running them
    // sequentially made free-provider open wait for models.dev timeout (often
    // unreachable) even when the provider list was already ready.
    const [res, catalogLoad] = await Promise.all([
      fetch(`${def.baseUrl.replace(/\/$/, "")}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${def.apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      }),
      loadModelsDevCatalogDetailed(),
    ]);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Failed to list models (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ""}` },
        { status: 502 },
      );
    }
    const json = await res.json() as OpenAiModelsResponse;
    const rawIds = Array.isArray(json?.data)
      ? json.data.map((m) => (typeof m?.id === "string" ? m.id : "")).filter(Boolean)
      : [];

    const models = buildFreeModelEntries(def, rawIds, catalogLoad.entries);

    return NextResponse.json({
      provider: def.id,
      providerKey: def.providerKey,
      displayName: def.displayName,
      baseUrl: def.baseUrl,
      api: def.api,
      models,
      catalogSource: catalogLoad.source,
      degraded: catalogLoad.source === "stale" || catalogLoad.source === "none",
    });
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === "AbortError" ? "Timed out fetching free models" : error.message)
      : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
