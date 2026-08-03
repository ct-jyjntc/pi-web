import { NextRequest, NextResponse } from "next/server";
import { getLspClientForFile, uriToPath } from "@/lib/lsp-client";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/lsp/query
 * Monaco editor language features backed by the shared LspClient pool.
 * Body: { cwd, path, action: hover|definition|references|rename, line, character, newName? }
 * line/character are 1-based (Monaco convention, matches the agent lsp tool).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      cwd?: string;
      path?: string;
      action?: string;
      line?: number;
      character?: number;
      newName?: string;
    } | null;
    const cwd = body?.cwd?.trim() ?? "";
    const filePath = body?.path?.trim() ?? "";
    const action = body?.action ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!filePath || (!filePath.startsWith("/") && !isWindowsAbsolutePath(filePath))) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }
    if (!["hover", "definition", "references", "rename"].includes(action)) {
      return NextResponse.json({ error: "action must be hover|definition|references|rename" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots) && !isFilePathAllowed(cwd, roots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!isExistingFilePathAllowed(filePath, roots) && !isFilePathAllowed(filePath, roots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const line = Math.max(1, Number(body?.line) || 1);
    const character = Math.max(1, Number(body?.character) || 1);

    const client = await getLspClientForFile(cwd, filePath);
    if (!client) {
      return NextResponse.json(
        { ok: false, error: "No external LSP server available for this file type" },
        { status: 404 },
      );
    }

    if (action === "hover") {
      const hover = await client.hover(filePath, line, character);
      return NextResponse.json({ ok: true, hover });
    }
    if (action === "definition" || action === "references") {
      const locs = action === "definition"
        ? await client.definition(filePath, line, character)
        : await client.references(filePath, line, character);
      return NextResponse.json({
        ok: true,
        locations: locs.map((l) => ({ path: uriToPath(l.uri), range: l.range })),
      });
    }
    const edits = await client.rename(filePath, line, character, String(body?.newName ?? ""));
    return NextResponse.json({ ok: true, edits });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
