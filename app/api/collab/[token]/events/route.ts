import { getCollabShare, readSessionSnapshot } from "@/lib/collab-live";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const share = getCollabShare(token);
  if (!share) {
    return new Response("not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSize = -1;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("ready", { token, sessionId: share.sessionId, mode: share.mode });

      const tick = () => {
        if (!share.sessionFile) {
          send("status", { exists: false });
          return;
        }
        const snap = readSessionSnapshot(share.sessionFile);
        if (!snap.exists) {
          send("status", { exists: false });
          return;
        }
        if (snap.size !== lastSize) {
          lastSize = snap.size;
          const lines = snap.content.split("\n").filter((l) => l.length > 0);
          send("update", {
            size: snap.size,
            mtimeMs: snap.mtimeMs,
            truncated: snap.truncated,
            // Full window (capped by readSessionSnapshot) so collab shows full chat history.
            lines,
          });
        } else {
          send("ping", { t: Date.now() });
        }
      };

      tick();
      timer = setInterval(tick, 1500);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
