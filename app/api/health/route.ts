/**
 * Ultra-light readiness probe for Electron cold start.
 * No SDK imports, no filesystem, no session registry — just "Node is accepting HTTP".
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
