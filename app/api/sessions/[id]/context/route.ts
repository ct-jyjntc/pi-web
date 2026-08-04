import { NextResponse } from "next/server";
import { estimateSessionContextUsage } from "@/lib/context-usage";
import {
  resolveSessionPath,
  readSessionHeader,
} from "@/lib/session-reader";
import {
  buildSessionContext,
  getSessionEntries,
  restoreDeferredMessages,
} from "@/lib/session-entries";

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
