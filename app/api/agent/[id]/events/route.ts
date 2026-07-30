import { existsSync } from "fs";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentEvent, type AgentSessionWrapper } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// `message_update` dominates SSE traffic: pi emits one per token delta and every
// frame carries the whole accumulated message twice (`message` plus
// `assistantMessageEvent.partial`), so a reply of L chars costs ~L²/4 bytes.
// Two fixes below: project the frame down to what the client reads, and coalesce
// consecutive frames on a short timer.
const MESSAGE_UPDATE_COALESCE_MS = 80;

/** Keep only the fields the client consumes (see handleAgentEvent in hooks/useAgentSession.ts). */
function projectMessageUpdate(event: AgentEvent): AgentEvent {
  return { type: event.type, message: event.message };
}

/**
 * Identity of the message a `message_update` belongs to. pi mutates a single
 * message object for the lifetime of one assistant stream, so `timestamp` is
 * stable per message and changes when the next message starts.
 */
function messageUpdateKey(event: AgentEvent): string {
  const message = event.message as { role?: unknown; timestamp?: unknown } | null | undefined;
  return `${String(message?.role ?? "")}:${String(message?.timestamp ?? "")}`;
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fast path: already-running session
  let session: AgentSessionWrapper | undefined = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath || !existsSync(filePath)) {
      return new Response("Session not found", { status: 404 });
    }
    // First line only — SessionManager.open() would parse the entire .jsonl
    // synchronously just to read the header cwd.
    const cwd = readSessionHeader(filePath)?.cwd ?? process.cwd();
    try {
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

      // Coalescing state for message_update. `pendingUpdateKey !== null` exactly
      // while a coalescing window (updateTimer) is open.
      let pendingUpdate: AgentEvent | null = null;
      let pendingUpdateKey: string | null = null;
      let updateTimer: ReturnType<typeof setTimeout> | null = null;

      const clearUpdateTimer = () => {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = null;
      };

      /**
       * Emit the coalesced update now. Called before every other event so a
       * pending update can never overtake a later one (a stale update delivered
       * after message_end would resurrect the finished message as streaming).
       */
      const flushMessageUpdate = () => {
        clearUpdateTimer();
        const pending = pendingUpdate;
        pendingUpdate = null;
        pendingUpdateKey = null;
        if (pending) encode(pending);
      };

      const onCoalesceWindowEnd = () => {
        updateTimer = null;
        const pending = pendingUpdate;
        pendingUpdate = null;
        if (!pending) {
          pendingUpdateKey = null;
          return;
        }
        encode(pending);
        // Keep the window rolling while deltas keep arriving, so the client sees
        // a steady one-frame-per-window rate instead of send/skip bursts.
        updateTimer = setTimeout(onCoalesceWindowEnd, MESSAGE_UPDATE_COALESCE_MS);
      };

      // Every message_update carries the full accumulated message rather than a
      // delta, so a later frame fully supersedes the ones it replaces and
      // dropping the intermediate frames loses nothing.
      const queueMessageUpdate = (event: AgentEvent) => {
        const key = messageUpdateKey(event);
        // Updates for a different message must not swallow the pending one.
        if (pendingUpdateKey !== null && pendingUpdateKey !== key) flushMessageUpdate();
        if (updateTimer === null) {
          // Leading edge: never delay the first frame of a message.
          encode(projectMessageUpdate(event));
          pendingUpdateKey = key;
          updateTimer = setTimeout(onCoalesceWindowEnd, MESSAGE_UPDATE_COALESCE_MS);
          return;
        }
        pendingUpdate = projectMessageUpdate(event);
        pendingUpdateKey = key;
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        req.signal?.removeEventListener("abort", onAbort);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        // Drop the coalesced update: nobody is listening anymore, and a live
        // timer would keep this closure (and the message it holds) alive.
        clearUpdateTimer();
        pendingUpdate = null;
        pendingUpdateKey = null;
        unsubscribe?.();
        unsubscribe = null;
      };

      const closeStream = () => {
        cleanup();
        try { controller.close(); } catch { /* ignore */ }
      };

      const onAbort = () => closeStream();

      // Stream body may start after the GET handler returned. Re-check liveness
      // so we never subscribe to a wrapper destroyed by concurrent fork/delete/idle.
      const live = getRpcSession(id);
      if (!live || !live.isAlive()) {
        encode({ type: "session_destroyed", sessionId: id });
        closeStream();
        return;
      }
      session = live;

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      unsubscribe = session.onEvent((event) => {
        if (event.type === "message_update") {
          queueMessageUpdate(event);
          return;
        }
        // Ordering guard: anything else takes the pending update's place in the
        // stream only after that update has been sent.
        flushMessageUpdate();
        encode(event);
        // The wrapper was destroyed (idle timeout, fork, delete) — close the
        // stream cleanly so the client's EventSource reconnects to the new wrapper.
        if (event.type === "session_destroyed") closeStream();
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Detect client disconnect via abort signal
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
