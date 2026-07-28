/**
 * Pure bash-command classification helpers — no imports, directly unit-testable
 * via `node --test` (see bash-command-classification.test.mjs).
 *
 * Used by lib/agent-bash-pty.ts to route agent bash commands between the local
 * non-PTY exec path (short commands) and the Terminal-panel PTY path
 * (long-lived services), and to reject misused foreground calls with
 * corrective guidance (Hermes-style enforcement).
 */

// ── Long-lived command detection ─────────────────────────────────────────────

/** Commands that typically keep running (dev servers, watchers, etc.). */
export function looksLikeLongRunningCommand(command: string): boolean {
  const c = command.toLowerCase();
  if (/\b(npm|pnpm|yarn|bunx?)\s+(run\s+)?(dev|start|serve|watch)\b/.test(c)) return true;
  if (/\b(next|vite|nuxt|remix|astro)\s+(dev|start|preview|serve)\b/.test(c)) return true;
  if (/\bvite$/.test(c.trim())) return true; // bare `vite` = dev server
  if (/\b(nodemon|webpack-dev-server|turbo\s+dev|wrangler\s+dev)\b/.test(c)) return true;
  if (/\bdocker(-compose|\s+compose)?\s+up\b/.test(c)) return true;
  if (/\b(uvicorn|gunicorn|flask\s+run|rails\s+s(erver)?)\b/.test(c)) return true;
  if (/\bcargo\s+watch\b/.test(c)) return true;
  if (/\bpython3?\s+-m\s+http\.server\b/.test(c)) return true;
  if (/\b(npx|pnpm\s+dlx|yarn\s+dlx)\s+\S*(serve|dev|storybook)\b/.test(c)) return true;
  if (/\b(--watch|\bwatch\b)\b/.test(c) && /\b(node|python3?|deno|tsx|ts-node|jest|vitest)\b/.test(c)) return true;
  // Explicit background job
  if (/&\s*$/.test(command.trim())) return true;
  return false;
}

// ── Foreground guardrail (Hermes-style corrective rejection) ─────────────────

/** Remove quoted spans so keywords inside strings don't trigger false positives
 *  (e.g. git commit -m "document npm run dev", python3 -c "os.setsid()"). */
function stripQuotes(command: string): string {
  return command.replace(/'[^']*'|"[^"]*"/g, " ");
}

/** Informational invocations should never be blocked. */
function looksLikeHelpOrVersion(command: string): boolean {
  const normalized = command.toLowerCase().split(/\s+/).join(" ");
  return (
    normalized.includes(" --help")
    || normalized.endsWith(" -h")
    || normalized.includes(" --version")
    || normalized.endsWith(" -v")
  );
}

const SHELL_BACKGROUND_WRAPPER_RE = /\b(nohup|setsid|disown)\b/;
const TRAILING_BACKGROUND_AMP_RE = /&\s*(?:#.*)?$/;

/**
 * Returns corrective guidance when a FOREGROUND command should have used
 * background: true, or null when the command is fine to run in foreground.
 * The returned text is surfaced as a tool error — the model reads it and retries.
 */
export function foregroundGuardrail(command: string): string | null {
  const unquoted = stripQuotes(command);
  if (looksLikeHelpOrVersion(unquoted)) return null;

  if (SHELL_BACKGROUND_WRAPPER_RE.test(unquoted)) {
    return (
      "Foreground command uses shell-level background wrappers (nohup/setsid/disown). " +
      "Retry with background: true so the process is tracked and mirrored in the user's " +
      "Terminal panel, then run readiness checks and tests in separate bash calls."
    );
  }

  if (TRAILING_BACKGROUND_AMP_RE.test(unquoted.trim())) {
    return (
      "Foreground command uses '&' backgrounding. Retry with background: true for " +
      "long-lived processes, then run health checks and tests in follow-up bash calls."
    );
  }

  if (looksLikeLongRunningCommand(unquoted)) {
    return (
      "This foreground command appears to start a long-lived server/watch process. " +
      "Retry with background: true — it will keep running in the user's Terminal panel " +
      "after the tool returns. Then verify readiness (health endpoint/log signal) and " +
      "run tests in a separate command."
    );
  }

  return null;
}
