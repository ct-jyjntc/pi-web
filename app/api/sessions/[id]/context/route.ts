import { NextResponse } from "next/server";
import { estimateSessionContextUsage } from "@/lib/context-usage";
import {
  resolveSessionPathAllowingChild,
  readSessionHeader,
} from "@/lib/session-reader";
import {
  buildSessionContext,
  getSessionEntries,
  getSessionManager,
  restoreDeferredMessages,
} from "@/lib/session-entries";
import { foldProjections } from "@/lib/session-projections";

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
    const parent = url.searchParams.get("parent");
    const filePath = await resolveSessionPathAllowingChild(id, parent);
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

    const projections = foldProjections({
      sessionId: id,
      title: getSessionManager(filePath).getSessionName() ?? null,
      messages: context.messages,
      contextPressure: contextUsage,
      sessionFile: filePath,
    });

    return NextResponse.json({ context, contextUsage, projections });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
