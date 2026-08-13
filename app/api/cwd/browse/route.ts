import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
} from "@/lib/directory-browser";

// GET /api/cwd/browse?path=... — list readable child directories.
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();
    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    const parentPath = getParentDirectory(resolved);
    const directories = await listDirectories(resolved);
    const drives = parentPath === null ? await listWindowsDrives() : [];
    const seen = new Set(directories.map((d) => d.path.toLowerCase()));
    const merged = [
      ...drives.filter((d) => !seen.has(d.path.toLowerCase())),
      ...directories,
    ];
    return NextResponse.json({
      path: resolved,
      parentPath,
      directories: merged,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
