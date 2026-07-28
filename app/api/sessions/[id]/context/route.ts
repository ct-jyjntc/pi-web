import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { estimateSessionContextUsage } from "@/lib/context-usage";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";

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

    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const context = buildSessionContext(entries, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    let contextUsage: Awaited<ReturnType<typeof estimateSessionContextUsage>> = null;
    try {
      const usageMessages = (deferThinking || deferToolResultImages)
        ? buildSessionContext(entries, leafId).messages
        : context.messages;
      contextUsage = await estimateSessionContextUsage({
        cwd: sm.getHeader()?.cwd ?? process.cwd(),
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
