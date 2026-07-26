import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  return NextResponse.json(readModelsJson());
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
