/** Lightweight web_fetch + multi-source web_search without extra native deps. */

export type WebFetchResult = {
  url: string;
  status: number;
  contentType: string;
  text: string;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

function assertHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost"
    || host === "127.0.0.1"
    || host === "0.0.0.0"
    || host === "::1"
    || host.endsWith(".local")
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("Refusing to fetch local/private network hosts");
  }
  return parsed;
}

export function stripHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

async function fetchText(
  url: string,
  options?: { signal?: AbortSignal; accept?: string; userAgent?: string },
): Promise<{ status: number; contentType: string; text: string; finalUrl: string }> {
  const target = assertHttpUrl(url).toString();
  try {
    const res = await fetch(target, {
      signal: options?.signal,
      headers: {
        "User-Agent": options?.userAgent ?? "Mozilla/5.0 (compatible; pi-web-agent/1.0)",
        Accept: options?.accept ?? "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2_000_000) {
      throw new Error(`Response too large (${buf.byteLength} bytes)`);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { status: res.status, contentType, text, finalUrl: res.url || target };
  } catch (error) {
    const cause = error instanceof Error
      ? (error as Error & { cause?: unknown }).cause ?? error.message
      : String(error);
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "(none)";
    throw new Error(
      `request failed for ${target}: ${cause instanceof Error ? cause.message : String(cause)} (proxy=${proxy})`,
    );
  }
}

export async function webFetch(
  url: string,
  options?: { maxChars?: number; signal?: AbortSignal },
): Promise<WebFetchResult> {
  const maxChars = options?.maxChars ?? 12_000;
  const res = await fetchText(url, { signal: options?.signal });
  let text = res.text;
  if (/html/i.test(res.contentType) || /<html/i.test(text.slice(0, 500))) {
    text = stripHtml(text);
  }
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n\n…(truncated)`;
  }
  return {
    url: res.finalUrl,
    status: res.status,
    contentType: res.contentType,
    text: `URL: ${res.finalUrl}\nStatus: ${res.status}\nContent-Type: ${res.contentType}\n\n${text}`,
  };
}

function decodeDuckUrl(href: string): string {
  try {
    if (href.includes("uddg=")) {
      const u = new URL(href, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    if (href.startsWith("//")) return `https:${href}`;
    return href;
  } catch {
    return href;
  }
}

function uniqResults(items: WebSearchResult[], limit: number): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const item of items) {
    const key = item.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (!item.url || !item.title || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function searchDuckDuckGoHtml(query: string, limit: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchText(url, {
    signal,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  if (res.status >= 400) throw new Error(`DuckDuckGo HTML HTTP ${res.status}`);
  const html = res.text;
  const results: WebSearchResult[] = [];

  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)|)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < limit * 2) {
    const href = decodeDuckUrl(m[1] ?? "");
    const title = stripHtml(m[2] ?? "").trim();
    const snippet = stripHtml(m[3] ?? "").trim();
    if (!href || !title || href.includes("duckduckgo.com")) continue;
    results.push({ title, url: href, snippet, source: "duckduckgo" });
  }

  if (results.length === 0) {
    const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)].map((x) => stripHtml(x[1] ?? ""));
    let i = 0;
    const re2 = /uddg=([^&"]+)/g;
    let mm: RegExpExecArray | null;
    while ((mm = re2.exec(html)) !== null && results.length < limit) {
      try {
        const href = decodeURIComponent(mm[1] ?? "");
        if (!href.startsWith("http")) continue;
        results.push({ title: titles[i] || href, url: href, snippet: "", source: "duckduckgo" });
        i += 1;
      } catch {
        // ignore
      }
    }
  }
  return uniqResults(results, limit);
}

/** DuckDuckGo Instant Answer JSON API — often works when HTML is blocked. */
async function searchDuckDuckGoInstant(query: string, limit: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetchText(url, {
    signal,
    accept: "application/json",
  });
  if (res.status >= 400) throw new Error(`DuckDuckGo API HTTP ${res.status}`);
  let data: {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
  };
  try {
    data = JSON.parse(res.text) as typeof data;
  } catch {
    throw new Error("DuckDuckGo API returned non-JSON");
  }
  const results: WebSearchResult[] = [];
  if (data.AbstractURL && (data.AbstractText || data.Heading)) {
    results.push({
      title: data.Heading || data.AbstractURL,
      url: data.AbstractURL,
      snippet: data.AbstractText || "",
      source: "duckduckgo-instant",
    });
  }
  const pushTopic = (t?: { Text?: string; FirstURL?: string }) => {
    if (!t?.FirstURL || !t.Text) return;
    results.push({
      title: t.Text.split(" - ")[0] || t.Text,
      url: t.FirstURL,
      snippet: t.Text,
      source: "duckduckgo-instant",
    });
  };
  for (const r of data.Results ?? []) pushTopic(r);
  for (const topic of data.RelatedTopics ?? []) {
    pushTopic(topic);
    for (const nested of topic.Topics ?? []) pushTopic(nested);
  }
  return uniqResults(results, limit);
}

/** Bing HTML lite fallback. */
async function searchBing(query: string, limit: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`;
  const res = await fetchText(url, {
    signal,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  if (res.status >= 400) throw new Error(`Bing HTTP ${res.status}`);
  const html = res.text;
  const results: WebSearchResult[] = [];
  // <li class="b_algo"> ... <h2><a href="...">title</a></h2> ... <p>snippet</p>
  const blocks = html.split(/class="b_algo"/i).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const m = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) continue;
    const href = m[1] ?? "";
    const title = stripHtml(m[2] ?? "").trim();
    const sm = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = stripHtml(sm?.[1] ?? "").trim();
    if (!href.startsWith("http") || !title) continue;
    results.push({ title, url: href, snippet, source: "bing" });
  }
  return uniqResults(results, limit);
}

export async function webSearch(
  query: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) throw new Error("query is required");
  const limit = options?.limit ?? 5;
  const errors: string[] = [];

  const providers: Array<() => Promise<WebSearchResult[]>> = [
    () => searchDuckDuckGoHtml(q, limit, options?.signal),
    () => searchDuckDuckGoInstant(q, limit, options?.signal),
    () => searchBing(q, limit, options?.signal),
  ];

  for (const provider of providers) {
    try {
      const results = await provider();
      if (results.length > 0) return results;
      errors.push("empty results");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`web_search failed for all providers: ${errors.join(" | ")}`);
}
