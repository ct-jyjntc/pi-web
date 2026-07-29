import { NextRequest, NextResponse } from "next/server";
import { readWebSettings } from "@/lib/web-settings";
import { webFetch, webSearch } from "@/lib/web-tools";

export const dynamic = "force-dynamic";

const DEFAULT_TARGETS = [
  "https://www.baidu.com",
  "https://cdn.jsdelivr.net/npm/jquery@3.7.1/package.json",
  "https://example.com",
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      urls?: string[];
      searchQuery?: string;
      skipSearch?: boolean;
    };
    const prefs = readWebSettings();
    // Ensure current settings proxy is visible to undici for this process.
    if (prefs.httpProxy) {
      process.env.HTTP_PROXY = prefs.httpProxy;
      process.env.HTTPS_PROXY = prefs.httpProxy;
    }
    if (prefs.proxyBypass) {
      process.env.NO_PROXY = prefs.proxyBypass;
    }

    const urls = Array.isArray(body.urls) && body.urls.length > 0
      ? body.urls.map(String)
      : DEFAULT_TARGETS;

    const fetches: Array<{
      url: string;
      ok: boolean;
      status?: number;
      ms: number;
      error?: string;
      sample?: string;
    }> = [];

    for (const url of urls) {
      const started = Date.now();
      try {
        const result = await webFetch(url, { maxChars: 400 });
        fetches.push({
          url,
          ok: result.status >= 200 && result.status < 400,
          status: result.status,
          ms: Date.now() - started,
          sample: result.text.slice(0, 160).replace(/\s+/g, " "),
        });
      } catch (error) {
        fetches.push({
          url,
          ok: false,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let search: {
      ok: boolean;
      ms: number;
      count?: number;
      error?: string;
      first?: { title: string; url: string };
    } | null = null;

    if (!body.skipSearch) {
      const q = (body.searchQuery || "TypeScript handbook").trim();
      const started = Date.now();
      try {
        const results = await webSearch(q, { limit: 3 });
        search = {
          ok: results.length > 0,
          ms: Date.now() - started,
          count: results.length,
          first: results[0] ? { title: results[0].title, url: results[0].url } : undefined,
        };
      } catch (error) {
        search = {
          ok: false,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const proxy = {
      httpProxy: prefs.httpProxy || "",
      proxyBypass: prefs.proxyBypass || "",
      envHttpProxy: process.env.HTTP_PROXY || process.env.http_proxy || "",
      envHttpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy || "",
      envNoProxy: process.env.NO_PROXY || process.env.no_proxy || "",
    };

    return NextResponse.json({
      ok: true,
      proxy,
      fetches,
      search,
      summary: {
        fetchOk: fetches.filter((f) => f.ok).length,
        fetchTotal: fetches.length,
        searchOk: search?.ok ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
