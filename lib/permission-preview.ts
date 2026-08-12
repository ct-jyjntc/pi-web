/**
 * Turn permission tool payloads (`todo?\\n{json}` or raw JSON) into a short title + lines.
 */
export function formatPermissionPreview(raw: string): { title?: string; lines: string[] } {
  const trimmed = raw.trim();
  if (!trimmed) return { lines: [] };

  const named = trimmed.match(/^([a-zA-Z][\w-]*)\??\s*([\s\S]*)$/);
  let tool: string | undefined;
  let payload = trimmed;
  if (named && (named[2]?.trim().startsWith("{") || named[2]?.trim() === "")) {
    tool = named[1];
    payload = named[2]!.trim();
  }

  if (payload.startsWith("{")) {
    try {
      const data = JSON.parse(payload) as Record<string, unknown>;
      const lines: string[] = [];
      const subject = pick(data, ["subject", "title", "command", "path", "name", "file"]);
      const desc = pick(data, ["description", "prompt", "message"]);
      const action = pick(data, ["action"]);
      if (action && subject) lines.push(`${action} · ${subject}`);
      else if (subject) lines.push(subject);
      else if (action) lines.push(action);
      if (desc && desc !== subject) lines.push(desc);
      if (lines.length === 0) {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string" && value.trim()) lines.push(`${key}: ${value}`);
          if (lines.length >= 4) break;
        }
      }
      return { title: tool, lines: lines.slice(0, 4) };
    } catch {
      /* not JSON */
    }
  }

  return { title: tool, lines: payload ? [payload] : [] };
}

function pick(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
