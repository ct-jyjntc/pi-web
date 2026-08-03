/**
 * User/project slash commands: markdown files with `$NAME` placeholders.
 * Reads `~/.pi/agent/commands/*.md` (user) and `<cwd>/.pi/commands/*.md`
 * (project); project commands win on name collisions.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type UserCommandSource = "user" | "project";

export type UserCommand = {
  name: string;
  description: string;
  /** Placeholder names in $UPPER_SNAKE form, in first-appearance order. */
  args: string[];
  body: string;
  source: UserCommandSource;
  path: string;
};

export function parseCommandPlaceholders(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\$([A-Z][A-Z0-9_]*)/g)) {
    found.add(match[1]);
  }
  return [...found];
}

export function extractCommandDescription(content: string): string {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (frontmatter) {
    const description = frontmatter[1].match(/^description:\s*(.+?)\s*$/m);
    if (description) return description[1];
  }
  const firstLine = content.split("\n").find((l) => l.trim().startsWith("description:"));
  if (firstLine) return firstLine.replace(/^description:\s*/, "").trim();
  return "";
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n/, "");
}

function readCommandsFromDir(dir: string, source: UserCommandSource): UserCommand[] {
  if (!existsSync(dir)) return [];
  const out: UserCommand[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) continue;
    const fullPath = join(dir, entry.name);
    try {
      const content = readFileSync(fullPath, "utf8");
      const body = stripFrontmatter(content);
      if (!body.trim()) continue;
      out.push({
        name,
        description: extractCommandDescription(content),
        args: parseCommandPlaceholders(body),
        body: body.trim(),
        source,
        path: fullPath,
      });
    } catch {
      // Skip unreadable command files.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Project commands first, then user commands (project wins by name). */
export function listUserCommands(cwd: string): UserCommand[] {
  const agentDir = join(homedir(), ".pi/agent");
  const user = readCommandsFromDir(join(agentDir, "commands"), "user");
  const project = readCommandsFromDir(join(cwd, ".pi/commands"), "project");
  const names = new Set<string>();
  const out: UserCommand[] = [];
  for (const command of [...project, ...user]) {
    if (names.has(command.name)) continue;
    names.add(command.name);
    out.push(command);
  }
  return out;
}

/** Fill `$NAME` placeholders; unknown placeholders are left untouched. */
export function renderCommandBody(body: string, values: Record<string, string>): string {
  return body.replace(/\$([A-Z][A-Z0-9_]*)/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}
