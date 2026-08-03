/**
 * Workspace turn journal API — undo/redo agent file mutations for a session.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getJournalStatus,
  redoWorkspaceTurn,
  undoWorkspaceTurn,
  undoWorkspaceTurnsThroughLeaf,
} from "@/lib/workspace-turn-journal";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...getJournalStatus(sessionId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      action?: string;
      leafId?: string;
    };
    const sessionId = body.sessionId?.trim() ?? "";
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    if (body.action === "undo-through") {
      const leafId = body.leafId?.trim() ?? "";
      if (!leafId) {
        return NextResponse.json({ error: "leafId required for undo-through" }, { status: 400 });
      }
      const batch = undoWorkspaceTurnsThroughLeaf(sessionId, leafId);
      if (!batch.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: batch.error ?? "Failed",
            undone: batch.undone,
            matchedLeaf: batch.matchedLeaf,
            restored: batch.restored,
            skipped: batch.skipped,
            status: getJournalStatus(sessionId),
          },
          { status: 409 },
        );
      }
      return NextResponse.json({
        ok: true,
        action: "undo-through",
        undone: batch.undone,
        matchedLeaf: batch.matchedLeaf,
        restored: batch.restored,
        skipped: batch.skipped,
        status: getJournalStatus(sessionId),
      });
    }

    const action = body.action === "redo" ? "redo" : body.action === "undo" ? "undo" : null;
    if (!action) {
      return NextResponse.json(
        { error: 'action must be "undo", "redo", or "undo-through"' },
        { status: 400 },
      );
    }

    const result = action === "undo"
      ? undoWorkspaceTurn(sessionId)
      : redoWorkspaceTurn(sessionId);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? "Failed",
          restored: result.restored,
          skipped: result.skipped,
          status: getJournalStatus(sessionId),
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      action,
      restored: result.restored,
      skipped: result.skipped,
      turnId: result.turn?.id,
      fileCount: result.turn?.files.length ?? 0,
      /** Pre-prompt leaf id — clients may navigate_tree here after undo. */
      userEntryId: action === "undo" ? result.turn?.userEntryId : undefined,
      status: getJournalStatus(sessionId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
