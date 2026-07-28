import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const path = getModelsPath();
  if (!existsSync(path)) return { ok: true, data: { providers: {} } };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

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

function parseCostNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Ensure every model.cost has input/output/cacheRead/cacheWrite as numbers (default 0). */
function normalizeProvidersCost(data: Record<string, unknown>): Record<string, unknown> {
  const providers = data.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return data;
  const nextProviders: Record<string, unknown> = {};
  for (const [name, rawProvider] of Object.entries(providers as Record<string, unknown>)) {
    if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) {
      nextProviders[name] = rawProvider;
      continue;
    }
    const provider = { ...(rawProvider as Record<string, unknown>) };
    const models = provider.models;
    if (Array.isArray(models)) {
      provider.models = models.map((rawModel) => {
        if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) return rawModel;
        const model = { ...(rawModel as Record<string, unknown>) };
        const cost = (model.cost && typeof model.cost === "object" && !Array.isArray(model.cost))
          ? (model.cost as Record<string, unknown>)
          : {};
        model.cost = {
          input: parseCostNumber(cost.input),
          output: parseCostNumber(cost.output),
          cacheRead: parseCostNumber(cost.cacheRead),
          cacheWrite: parseCostNumber(cost.cacheWrite),
        };
        return model;
      });
    }
    nextProviders[name] = provider;
  }
  return { ...data, providers: nextProviders };
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsJson(normalizeProvidersCost(body));
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
