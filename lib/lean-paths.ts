/**
 * Extract file paths from agent tool-call arguments for turn-scoped lean review.
 * Client-safe (no fs).
 */

function pushPath(out: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 800) return;
  // Skip obvious non-paths
  if (/^https?:\/\//i.test(trimmed)) return;
  out.add(trimmed);
}

/** Pull paths from a single toolCall-like object. */
export function pathsFromToolCall(toolName: string, input: unknown): string[] {
  const name = toolName.toLowerCase();
  const out = new Set<string>();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    if (typeof input === "string" && /edit|write|patch/.test(name)) {
      const m = input.match(/\[(.+?)#[0-9A-Fa-f]{4}\]/);
      if (m) pushPath(out, m[1]);
    }
    return [...out];
  }
  const rec = input as Record<string, unknown>;

  if (typeof rec.path === "string") pushPath(out, rec.path);
  if (typeof rec.file_path === "string") pushPath(out, rec.file_path);
  if (typeof rec.filePath === "string") pushPath(out, rec.filePath);
  if (Array.isArray(rec.paths)) {
    for (const p of rec.paths) pushPath(out, p);
  }

  if (typeof rec.input === "string") {
    for (const m of rec.input.matchAll(/\[(.+?)#[0-9A-Fa-f]{4}\]/g)) {
      pushPath(out, m[1]);
    }
  }

  // write({ path, content }) / create
  if (/write|create|edit|patch|replace|delete|move|rename/.test(name)) {
    if (typeof rec.to === "string") pushPath(out, rec.to);
    if (typeof rec.from === "string") pushPath(out, rec.from);
  }

  return [...out];
}

/** Collect unique paths from assistant content blocks (toolCall list). */
export function pathsFromAssistantContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "toolCall") continue;
    const toolName = String(b.toolName ?? b.name ?? "");
    const input = b.input ?? b.arguments ?? b.args;
    for (const p of pathsFromToolCall(toolName, input)) out.add(p);
  }
  return [...out];
}
