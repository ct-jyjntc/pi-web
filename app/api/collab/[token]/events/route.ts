import { watch, type FSWatcher } from "fs";
import { getCollabShare, SessionTailReader } from "@/lib/collab-live";

export const dynamic = "force-dynamic";

/** Coalesce fs.watch bursts — one appended record can fire several events. */
const WATCH_DEBOUNCE_MS = 200;
/**
 * Floor between pushes. The wire format is a full replace (viewers rebuild their
 * transcript from `lines`), so this keeps the serialization cost per viewer at
 * the cadence of the previous 1.5s poll while still reacting within
 * WATCH_DEBOUNCE_MS to the first change after an idle stretch.
 */
const MIN_PUSH_INTERVAL_MS = 1500;
/**
 * Safety poll: fs.watch semantics differ across macOS/Linux/Windows and a
 * watcher can go deaf after the file is replaced, so a cheap stat still runs on
 * a slow timer. It only costs one stat when nothing changed.
 */
const FALLBACK_POLL_MS = 5000;
/** Keep-alive, decoupled from file activity (the old code only pinged on poll ticks). */
const HEARTBEAT_MS = 15_000;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const share = getCollabShare(token);
  if (!share) {
    return new Response("not found", { status: 404 });
  }

  const sessionFile = share.sessionFile;
  const encoder = new TextEncoder();
  let closed = false;
  let watcher: FSWatcher | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let onAbort: (() => void) | null = null;

  const disposeWatcher = () => {
    if (!watcher) return;
    try { watcher.close(); } catch { /* already closed */ }
    watcher = null;
  };

  // Runtimes call either cancel() or abort the request signal — never rely on
  // just one, or the watcher/timers outlive the response forever.
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (onAbort) request.signal?.removeEventListener("abort", onAbort);
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    disposeWatcher();
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client already disconnected
        }
      };

      onAbort = () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal?.addEventListener("abort", onAbort);

      send("ready", { token, sessionId: share.sessionId, mode: share.mode });
      heartbeatTimer = setInterval(() => send("ping", { t: Date.now() }), HEARTBEAT_MS);

      if (!sessionFile) {
        // Nothing to follow; keep the stream open so the viewer stays connected.
        send("status", { exists: false });
        return;
      }

      const reader = new SessionTailReader(sessionFile);
      let polling = false;
      let pollQueued = false;
      let lastPollAt = 0;

      const schedulePoll = () => {
        if (closed || pushTimer) return;
        const wait = Math.max(WATCH_DEBOUNCE_MS, MIN_PUSH_INTERVAL_MS - (Date.now() - lastPollAt));
        pushTimer = setTimeout(() => {
          pushTimer = null;
          void runPoll();
        }, wait);
      };

      const armWatcher = () => {
        if (closed || watcher) return;
        try {
          watcher = watch(sessionFile, (eventType) => {
            // "rename" means the path was replaced or removed, so this watcher no
            // longer tracks the live file — drop it and let the poll re-arm.
            if (eventType === "rename") disposeWatcher();
            schedulePoll();
          });
          watcher.on("error", disposeWatcher);
        } catch {
          // File not created yet (or watch unsupported) — the fallback retries.
          watcher = null;
        }
      };

      const runPoll = async () => {
        if (closed) return;
        if (polling) {
          pollQueued = true;
          return;
        }
        polling = true;
        lastPollAt = Date.now();
        try {
          const result = await reader.poll();
          if (closed) return;
          if (!result.exists) {
            if (result.changed) send("status", { exists: false });
            return;
          }
          // The file was rewritten (cascade re-parent, pi migration): the watcher
          // may be bound to the old inode now.
          if (result.reset) {
            disposeWatcher();
            armWatcher();
          }
          if (!result.changed) return;
          const payload: Record<string, unknown> = {
            size: result.size,
            mtimeMs: result.mtimeMs,
            truncated: result.truncated,
          };
          // Only resend the window when it actually changed; a size-only change
          // (a record still being written) just refreshes the counters.
          if (result.linesChanged || result.reset) payload.lines = reader.lines;
          send("update", payload);
        } catch {
          // Transient fs error: keep the current window and retry on the next event.
        } finally {
          polling = false;
          if (pollQueued && !closed) {
            pollQueued = false;
            schedulePoll();
          }
        }
      };

      // Arm before the first read so nothing appended in between is missed.
      armWatcher();
      void runPoll();
      // fs.watch streams start asynchronously on some platforms (FSEvents), so a
      // write landing right after connect can be dropped — settle with one
      // throttled follow-up poll instead of waiting for the slow fallback.
      schedulePoll();
      fallbackTimer = setInterval(() => {
        if (!watcher) armWatcher();
        schedulePoll();
      }, FALLBACK_POLL_MS);
    },
    cancel() {
      cleanup();
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
