import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { collectDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

function allowed(target: string, roots: Set<string>): boolean {
  return isExistingFilePathAllowed(target, roots) || isFilePathAllowed(target, roots);
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() || undefined;
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!allowed(cwd, roots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    if (filePath && !allowed(filePath, roots) && !filePath.startsWith(cwd)) {
      // allow relative-looking paths resolved by diagnostics
    }
    const result = await collectDiagnostics(cwd, { filePath });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
