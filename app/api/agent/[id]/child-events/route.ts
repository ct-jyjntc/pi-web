/**
 * Live SSE for a child subagent. Subscribes to the existing ChildRun.
 * Never startRpcSession on the child file.
 */
import { getChildRun, getSubagentHost } from "@/lib/first-party/subagents/host";
import type { ChildRun } from "@/lib/first-party/subagents/child-session";
import { toClientAgentEvent } from "@/lib/agent-event-wire";
import { normalizeToolCalls } from "@/lib/normalize";
import { attachPresentationToMessages } from "@/lib/tool-presentation";
import type { AgentMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: parentSessionId } = await params;
  const childSessionId = new URL(req.url).searchParams.get("child")?.trim() ?? "";
  if (!childSessionId) {
    return new Response("child query required", { status: 400 });
  }
  if (!getSubagentHost(parentSessionId)) {
    return new Response("No subagent host for this session", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let attachTimer: ReturnType<typeof setInterval> | null = null;

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
        if (attachTimer) clearInterval(attachTimer);
        attachTimer = null;
        unsubscribe?.();
        unsubscribe = null;
      };

      const closeStream = () => {
        cleanup();
        try { controller.close(); } catch { /* ignore */ }
      };

      const onAbort = () => closeStream();

      const attach = (run: ChildRun) => {
        const pending: Array<{ type?: string; [key: string]: unknown }> = [];
        let ready = false;
        const emit = (event: { type?: string; [key: string]: unknown }) => {
          if (!event.type) return;
          const client = toClientAgentEvent({ ...event, type: event.type });
          if (client) encode(client);
        };
        unsubscribe = run.subscribe((event) => {
          if (!ready) {
            pending.push(event);
            return;
          }
          emit(event);
        });
        encode({
          type: "connected",
          sessionId: childSessionId,
          isStreaming: run.isStreaming(),
        });
        const snapshot = run.streamingMessage();
        if (snapshot && typeof snapshot === "object") {
          const presented = attachPresentationToMessages([
            normalizeToolCalls(snapshot as AgentMessage),
          ])[0];
          encode({ type: "message_start", message: presented });
        }
        ready = true;
        for (const event of pending) {
          if (event.type === "message_update") continue;
          emit(event);
        }
      };

      const existing = getChildRun(childSessionId);
      if (existing && existing.parentSessionId === parentSessionId) {
        attach(existing.run);
      } else {
        encode({ type: "connected", sessionId: childSessionId, isStreaming: false });
        const started = Date.now();
        attachTimer = setInterval(() => {
          if (closed) return;
          const found = getChildRun(childSessionId);
          if (found && found.parentSessionId === parentSessionId) {
            if (attachTimer) clearInterval(attachTimer);
            attachTimer = null;
            attach(found.run);
            return;
          }
          if (Date.now() - started > 30_000) {
            if (attachTimer) clearInterval(attachTimer);
            attachTimer = null;
          }
        }, 200);
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
