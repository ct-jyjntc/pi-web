import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { executeAtomicCommits, planAtomicCommits } from "@/lib/git-commit-split";

export const dynamic = "force-dynamic";

function isAbs(p: string): boolean {
  return p.startsWith("/") || isWindowsAbsolutePath(p);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      mode?: string;
      includeUnstaged?: boolean;
      preferAi?: boolean;
      groups?: Array<{ message?: string; paths?: string[] }>;
    };
    const cwd = body.cwd?.trim() ?? "";
    const mode = body.mode?.trim() || "plan";

    if (!cwd || !isAbs(cwd)) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (mode !== "plan" && mode !== "execute") {
      return NextResponse.json({ error: "mode must be plan|execute" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    try {
      fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    if (mode === "plan") {
      const plan = await planAtomicCommits(cwd, {
        includeUnstaged: body.includeUnstaged !== false,
        preferAi: body.preferAi !== false,
      });
      return NextResponse.json({ ok: true, ...plan });
    }

    const groups = Array.isArray(body.groups) ? body.groups : [];
    for (const g of groups) {
      for (const p of g.paths ?? []) {
        if (!isAbs(String(p))) {
          return NextResponse.json({ error: "group paths must be absolute" }, { status: 400 });
        }
        // Prefer realpath-aware check so macOS /var → /private/var roots still match.
        const abs = String(p);
        if (!isExistingFilePathAllowed(abs, allowedRoots) && !isFilePathAllowed(abs, allowedRoots)) {
          return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
      }
    }

    const result = await executeAtomicCommits(
      cwd,
      groups.map((g) => ({
        message: String(g.message ?? ""),
        paths: (g.paths ?? []).map(String),
      })),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
