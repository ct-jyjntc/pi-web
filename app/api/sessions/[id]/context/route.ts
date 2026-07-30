import { NextResponse } from "next/server";
import { estimateSessionContextUsage } from "@/lib/context-usage";
import { normalizeToolCalls } from "@/lib/normalize";
import {
  resolveSessionPath,
  buildSessionContext,
  getSessionEntries,
  readSessionHeader,
} from "@/lib/session-reader";
import type { AgentMessage, SessionContext, SessionEntry } from "@/lib/types";

/**
 * Undo the defer transforms for token estimation only.
 *
 * The client always asks for deferred thinking/media, but the usage number must
 * reflect the full history. Rebuilding the context a second time without the
 * defer flags re-walks every entry in the archive; instead, restore each context
 * slot from its source entry: buildSessionContext renders a `message` entry as
 * exactly `normalizeToolCalls(entry.message)` when nothing is deferred, and
 * `entryIds[i]` is parallel to `messages[i]`. Non-message entries (compaction,
 * branch summaries, custom messages) are never deferred, so they pass through.
 */
function restoreDeferredMessages(
  context: SessionContext,
  entries: SessionEntry[],
): AgentMessage[] {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return context.messages.map((message, index) => {
    const entry = byId.get(context.entryIds[index]);
    return entry?.type === "message" ? normalizeToolCalls(entry.message) : message;
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Shared, cached entries — read-only here and in buildSessionContext.
    const entries = getSessionEntries(filePath);
    const context = buildSessionContext(entries, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    let contextUsage: Awaited<ReturnType<typeof estimateSessionContextUsage>> = null;
    try {
      const usageMessages = (deferThinking || deferToolResultImages)
        ? restoreDeferredMessages(context, entries)
        : context.messages;
      contextUsage = await estimateSessionContextUsage({
        cwd: readSessionHeader(filePath)?.cwd ?? process.cwd(),
        model: context.model,
        messages: usageMessages,
      });
    } catch {
      contextUsage = null;
    }

    return NextResponse.json({ context, contextUsage });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
