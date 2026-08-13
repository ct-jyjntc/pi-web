/**
 * Shared skill-catalog helpers: path display, scope grouping, update keys.
 */

import type { SkillInfo as Skill } from "@/lib/api-types";

export type SkillScope = "global" | "project" | "path";

export function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function skillScope(skill: Skill): SkillScope {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

export function updateKey(skill: Skill): string | null {
  return skill.install ? `${skill.install.scope}\0${skill.install.package}` : null;
}

export function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

/** Drop a leading H1 so the detail dialog does not repeat the skill title. */
export function previewSkillMarkdown(body: string): string {
  return body.replace(/^\uFEFF?\s*#\s+[^\n]+\n+/, "").trim();
}

export function displayPath(skill: Skill, cwd: string): string {
  const path = skill.filePath;
  if (skillScope(skill) === "project" && path.startsWith(cwd)) {
    const rel = path.slice(cwd.length).replace(/^[/\\]/, "");
    return `./${rel}`;
  }
  return shortenPath(path);
}
