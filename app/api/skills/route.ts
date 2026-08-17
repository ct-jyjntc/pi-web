import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { filePath: string; disableModelInvocation: boolean };
    const { filePath, disableModelInvocation } = body;
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });

    const allowedRoots = new Set(await getAllowedFileRoots());
    allowedRoots.add(getAgentDir());
    // Globally installed skills live in ~/.agents/skills and are often symlinked
    // into the agent skills dir; resolve may land outside getAgentDir().
    const globalSkillsDir = path.join(homedir(), ".agents", "skills");
    if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
    if (!isFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Resolve symlinks before read/write: a path that is lexically inside an
    // allowed root but whose target escapes it must not be followed.
    if (!isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const content = readFileSync(filePath, "utf8");
    const key = "disable-model-invocation";
    // Always strip existing key lines first so `false` → `true` cannot leave
    // duplicate YAML keys (Boolean(false) previously skipped the write).
    const keyLine = new RegExp(`^${key}\\s*:.*\\r?\\n`, "m");
    let updated = content.replace(keyLine, "");

    if (disableModelInvocation) {
      // Use parseFrontmatter only to detect whether a frontmatter block exists.
      parseFrontmatter<Record<string, unknown>>(updated);
      const withKey = updated.replace(/^---\r?\n/, `---\n${key}: true\n`);
      updated = withKey === updated ? `---\n${key}: true\n---\n${updated}` : withKey;
    }

    writeFileSync(filePath, updated, "utf8");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
