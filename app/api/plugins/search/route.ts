import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 24;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const NPM_SEARCH = "https://registry.npmjs.org/-/v1/search";

export interface PluginSearchResult {
  name: string;
  version: string;
  description: string;
  source: string;
  url: string;
  weeklyDownloads?: number;
  publisher?: string;
  keywords: string[];
}

function parseLimit(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

function buildQuery(raw: string): string {
  const q = raw.trim();
  // Always constrain to pi packages so the catalog stays relevant.
  if (!q) return "keywords:pi-package";
  if (/\bkeywords:pi-package\b/i.test(q)) return q;
  return `${q} keywords:pi-package`;
}

function toResult(pkg: {
  name?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  links?: { npm?: string; homepage?: string };
  publisher?: { username?: string };
}): PluginSearchResult | null {
  const name = pkg.name?.trim();
  if (!name) return null;
  const version = pkg.version?.trim() || "latest";
  return {
    name,
    version,
    description: (pkg.description ?? "").trim(),
    source: `npm:${name}`,
    url: pkg.links?.npm || `https://www.npmjs.com/package/${name}`,
    publisher: pkg.publisher?.username,
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
  };
}

// GET /api/plugins/search?q=&limit=
// POST /api/plugins/search  body: { query?: string, limit?: number }
async function handleSearch(query: string, limit: number) {
  const text = buildQuery(query);
  const url = `${NPM_SEARCH}?text=${encodeURIComponent(text)}&size=${limit}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`npm search failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    total?: number;
    objects?: Array<{ package?: Parameters<typeof toResult>[0]; score?: { final?: number } }>;
  };
  const results = (data.objects ?? [])
    .map((obj) => toResult(obj.package ?? {}))
    .filter((item): item is PluginSearchResult => item !== null);

  return {
    results,
    total: typeof data.total === "number" ? data.total : results.length,
    query: text,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") ?? searchParams.get("query") ?? "";
    const limit = parseLimit(searchParams.get("limit"));
    const payload = await handleSearch(query, limit);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { query?: string; limit?: unknown };
    const payload = await handleSearch(body.query ?? "", parseLimit(body.limit));
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
