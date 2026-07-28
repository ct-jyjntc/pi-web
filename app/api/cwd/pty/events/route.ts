import path from "path";
import { NextRequest } from "next/server";
import { listPtySessions, subscribePtyRegistry } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Registry stream: discover agent (and user) PTY sessions as they appear. */
export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() || undefined;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseChunk(event, data)));
        } catch {
          // closed
        }
      };

      const matchesCwd = (sessionCwd: string) => {
        if (!cwd) return true;
        try {
          return path.resolve(sessionCwd) === path.resolve(cwd);
        } catch {
          return sessionCwd === cwd;
        }
      };

      send("snapshot", { sessions: listPtySessions(cwd ? { cwd } : undefined) });

      unsubscribe = subscribePtyRegistry((event) => {
        if (event.type === "upsert" && event.session) {
          if (!matchesCwd(event.session.cwd)) return;
          send("upsert", { session: event.session });
          return;
        }
        if (event.type === "remove" && event.id) {
          send("remove", { id: event.id });
        }
      });

      heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15_000);
      heartbeat.unref?.();

      const onAbort = () => {
        cleanup();
        try { controller.close(); } catch { /* ignore */ }
      };
      request.signal.addEventListener("abort", onAbort);

      function cleanup() {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", onAbort);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
