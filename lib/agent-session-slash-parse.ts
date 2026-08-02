/**
 * Parse a chat `/command args` line for built-in slash handling.
 */

export type ParsedSlashCommand = {
  name: string;
  args: string;
};

/** Returns null when the text is not a slash command line. */
export function parseSlashCommandLine(text: string): ParsedSlashCommand | null {
  if (!text.startsWith("/")) return null;
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const [, name, rawArgs = ""] = match;
  return { name, args: rawArgs.trim() };
}
