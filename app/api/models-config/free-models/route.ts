import { NextResponse } from "next/server";
import { filterFreeModelIds, getFreeProvider, type FreeProviderId } from "@/lib/free-providers";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 15_000;

type OpenAiModelsResponse = {
  data?: Array<{ id?: unknown }>;
};

export async function GET(req: Request) {
  const providerId = new URL(req.url).searchParams.get("provider") as FreeProviderId | null;
  const def = getFreeProvider(providerId);
  if (!def) {
    return NextResponse.json({ error: "Unknown free provider" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${def.baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${def.apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
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
    const models = filterFreeModelIds(def, rawIds).map((id) => ({ id, name: id }));
    return NextResponse.json({
      provider: def.id,
      providerKey: def.providerKey,
      displayName: def.displayName,
      baseUrl: def.baseUrl,
      api: def.api,
      models,
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
