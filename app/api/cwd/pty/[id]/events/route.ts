import { NextRequest } from "next/server";
import { subscribePtySession } from "@/lib/pty-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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
          // stream already closed
        }
      };

      // Declared before subscribe: exited sessions replay exit synchronously,
      // which runs cleanup() before subscribePtySession() returns.
      const onAbort = () => {
        cleanup();
        try { controller.close(); } catch { /* ignore */ }
      };

      function cleanup() {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", onAbort);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
      }

      try {
        unsubscribe = subscribePtySession(id, (evt) => {
          if (evt.type === "data") send("data", { data: evt.data });
          else if (evt.type === "ready") send("ready", evt);
          else if (evt.type === "exit") {
            send("exit", { exitCode: evt.exitCode, signal: evt.signal });
            cleanup();
            try { controller.close(); } catch { /* ignore */ }
          }
        });
      } catch (error) {
        send("error", { error: error instanceof Error ? error.message : String(error) });
        cleanup();
        try { controller.close(); } catch { /* ignore */ }
        return;
      }

      if (closed) {
        // Synchronous exit replay already cleaned up; drop the listener that
        // was registered before cleanup ran and skip heartbeat/abort wiring.
        unsubscribe?.();
        unsubscribe = null;
        return;
      }

      send("hello", { id });
      heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15_000);
      heartbeat.unref?.();

      request.signal.addEventListener("abort", onAbort);
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
