/**
 * Light-path slash command loaders for the composer palette.
 * Custom commands and skills do not need a live AgentSession.
 */
import { apiFetch } from "@/lib/api-transport";

export type PaletteSlashCommand = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "custom";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
};

export async function loadCustomSlashCommands(
  cwdValue: string | null | undefined,
): Promise<PaletteSlashCommand[]> {
  if (!cwdValue) return [];
  try {
    const res = await apiFetch(`/api/commands?cwd=${encodeURIComponent(cwdValue)}`);
    if (!res.ok) return [];
    const body = await res.json() as {
      commands?: Array<{ name: string; description?: string; args: string[]; source: "user" | "project" }>;
    };
    return (body.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description || (c.args.length > 0 ? `args: ${c.args.join(", ")}` : "Custom command"),
      source: "custom" as const,
      sourceInfo: {
        path: cwdValue,
        source: c.source,
        scope: "project" as const,
        origin: "top-level" as const,
      },
    }));
  } catch {
    return [];
  }
}

/** Skills via DefaultResourceLoader — same catalog as /api/skills, no heavy session. */
export async function loadSkillSlashCommands(
  cwdValue: string | null | undefined,
): Promise<PaletteSlashCommand[]> {
  if (!cwdValue) return [];
  try {
    const res = await apiFetch(`/api/skills?cwd=${encodeURIComponent(cwdValue)}`);
    if (!res.ok) return [];
    const body = await res.json() as {
      skills?: Array<{
        name: string;
        description?: string;
        filePath?: string;
        sourceInfo?: { source?: string; scope?: string };
      }>;
    };
    return (body.skills ?? []).map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description || skill.name,
      source: "skill" as const,
      sourceInfo: {
        path: skill.filePath || cwdValue,
        source: skill.sourceInfo?.source || "user",
        scope: (skill.sourceInfo?.scope === "project" ? "project" : "user") as "user" | "project",
        origin: "top-level" as const,
      },
    }));
  } catch {
    return [];
  }
}

/** Merge session get_commands with light custom/skill lists (session rows win on name). */
export function mergeSlashCommandLists(
  custom: PaletteSlashCommand[],
  fromSession: PaletteSlashCommand[],
  skills: PaletteSlashCommand[],
): PaletteSlashCommand[] {
  const sessionNames = new Set(fromSession.map((c) => c.name));
  const skillFallback = skills.filter((s) => !sessionNames.has(s.name));
  return [...custom, ...fromSession, ...skillFallback];
}
