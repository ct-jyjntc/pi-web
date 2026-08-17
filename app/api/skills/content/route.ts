import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/skills/content?path=<absolute SKILL.md path>
// Returns markdown body (frontmatter stripped) for the skills settings preview.
export async function GET(req: Request) {
  const filePath = new URL(req.url).searchParams.get("path")?.trim() ?? "";
  if (!filePath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  if (!path.isAbsolute(filePath)) {
    return NextResponse.json({ error: "path must be absolute" }, { status: 400 });
  }

  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }

    const allowedRoots = new Set(await getAllowedFileRoots());
    allowedRoots.add(getAgentDir());
    const globalSkillsDir = path.join(homedir(), ".agents", "skills");
    if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
    // Also allow the skill's parent package roots under agent npm.
    const agentNpm = path.join(getAgentDir(), "npm");
    if (existsSync(agentNpm)) allowedRoots.add(agentNpm);

    if (!isFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Resolve symlinks before read: a path that is lexically inside an allowed
    // root but whose target escapes it must not be followed.
    if (!isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const raw = readFileSync(filePath, "utf8");
    const { body } = parseFrontmatter(raw);
    return NextResponse.json({
      path: filePath,
      body: body.trim() ? body : raw,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
