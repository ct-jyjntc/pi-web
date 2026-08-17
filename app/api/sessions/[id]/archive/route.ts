import { NextResponse } from "next/server";
import { promises as fsp } from "fs";
import {
  resolveSessionPath,
  readSessionHeader,
  invalidateSessionPathCache,
  invalidateSessionListCache,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-registry";

/**
 * Soft-archive for a session: toggles the `archived`/`archivedAt` header fields
 * (see lib/types.ts SessionHeader) via an atomic header rewrite. Archived
 * sessions stay on disk and are excluded from the main sidebar list; they are
 * managed under Settings → Archived. POST = archive, DELETE = restore.
 *
 * Heavy runtime only — destroy-before-rewrite needs the RPC registry, and this
 * path is not in runtime-host.js LIGHT_EXACT/PREFIXES so it routes heavy.
 */

/** Rewrite only the session header line, preserving every other field the SDK
 *  may have written. Mirrors the atomic tmp + rename used by DELETE reparent in
 *  the sibling route. */
async function rewriteHeader(
  filePath: string,
  mutate: (header: Record<string, unknown>) => void,
): Promise<void> {
  const content = await fsp.readFile(filePath, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
  const rest = newlineIndex >= 0 ? content.slice(newlineIndex) : "";
  const header = JSON.parse(firstLine) as Record<string, unknown>;
  mutate(header);
  const tmpPath = `${filePath}.archive.${process.pid}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(header)}${rest}`);
  await fsp.rename(tmpPath, filePath);
}

function notFound() {
  return NextResponse.json({ error: "Session not found" }, { status: 404 });
}
function unreadable() {
  return NextResponse.json({ error: "Session header unreadable" }, { status: 422 });
}

// POST /api/sessions/[id]/archive — soft-archive: hide from the sidebar list.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return notFound();
    if (!readSessionHeader(filePath)) return unreadable();
    // Stop a live wrapper before rewriting its file so the next open re-reads
    // the fresh header (an append-only file would not race the header line,
    // but the in-memory wrapper would serve a stale archived flag). Mirrors
    // DELETE's destroy-before-unlink.
    getRpcSession(id)?.destroy();
    const archivedAt = new Date().toISOString();
    await rewriteHeader(filePath, (header) => {
      header.archived = true;
      header.archivedAt = archivedAt;
    });
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, archivedAt });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]/archive — un-archive: restore to the sidebar list.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return notFound();
    if (!readSessionHeader(filePath)) return unreadable();
    getRpcSession(id)?.destroy();
    await rewriteHeader(filePath, (header) => {
      delete header.archived;
      delete header.archivedAt;
    });
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
