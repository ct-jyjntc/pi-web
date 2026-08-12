/**
 * One owner: how a composer-attached skill becomes a prompt, and its display name.
 */

export interface AttachedSkill {
  name: string;
  description?: string;
}

/** Build the `/skill:name` prompt the SDK expands. Does not double-wrap. */
export function formatSkillPrompt(skillName: string | undefined, userText: string): string {
  const trimmed = userText.trim();
  if (!skillName) return trimmed;
  if (trimmed.startsWith("/skill:")) return trimmed;
  return trimmed ? `/skill:${skillName} ${trimmed}` : `/skill:${skillName}`;
}

/** Title-case hyphenated skill ids; leave CJK / mixed names alone. */
export function displaySkillName(name: string): string {
  if (!name || /[^\u0000-\u007f]/.test(name)) return name;
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (
      part.length <= 2
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1)
    ))
    .join(" ");
}
