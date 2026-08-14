import { existsSync } from "fs";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-registry";
import type { AgentEvent, AgentSessionWrapper } from "@/lib/rpc-session-wrapper";
import { toClientAgentEvent } from "@/lib/agent-event-wire";
import { normalizeToolCalls } from "@/lib/normalize";
import { attachPresentationToMessages } from "@/lib/tool-presentation";
import type { AgentMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events (Pi 0.84+ linear deltas)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let session: AgentSessionWrapper | undefined = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath || !existsSync(filePath)) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = readSessionHeader(filePath)?.cwd ?? process.cwd();
    try {
      const { startRpcSession } = await import("@/lib/rpc-session-start");
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const encode = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client already disconnected
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        req.signal?.removeEventListener("abort", onAbort);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
      };

      const closeStream = () => {
        cleanup();
        try { controller.close(); } catch { /* ignore */ }
      };

      const onAbort = () => closeStream();

      const live = getRpcSession(id);
      if (!live || !live.isAlive()) {
        encode({ type: "session_destroyed", sessionId: id });
        closeStream();
        return;
      }
      session = live;
      const pending: AgentEvent[] = [];
      let ready = false;
      const emit = (event: AgentEvent) => {
        const client = toClientAgentEvent(event);
        if (client) encode(client);
        if (event.type === "session_destroyed") closeStream();
      };

      unsubscribe = session.onEvent((event: AgentEvent) => {
        if (!ready) {
          pending.push(event);
          return;
        }
        emit(event);
      });

      const snapshot = session.streamingMessage;
      encode({ type: "connected", sessionId: id, isStreaming: session.isStreaming });
      if (snapshot && typeof snapshot === "object") {
        const presented = attachPresentationToMessages([
          normalizeToolCalls(snapshot as AgentMessage),
        ])[0];
        encode({ type: "message_start", message: presented });
      }
      ready = true;
      for (const event of pending) {
        // Snapshot already has the latest assistant text at subscribe time.
        if (event.type === "message_update") continue;
        emit(event);
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      req.signal?.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
