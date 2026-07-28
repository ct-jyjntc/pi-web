/**
 * Bash tool backend for Pi Web:
 * - Short / normal commands → local non-PTY exec (no Terminal tab)
 * - Long-running / server-style commands → real PTY in Terminal UI
 *   Tool returns after startup so the agent is not blocked; the process
 *   keeps running until the user stops it in Terminal (or it exits).
 */
import {
  createLocalBashOperations,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";
import { createPtySession, destroyPtySession, getPtySession, subscribePtySession } from "./pty-sessions";

/** How long to stream startup logs into the tool result before detaching. */
const LONG_RUNNING_STARTUP_MS = 2_500;

/** Commands that typically keep running (dev servers, watchers, etc.). */
export function looksLikeLongRunningCommand(command: string): boolean {
  const c = command.toLowerCase();
  if (/\b(npm|pnpm|yarn|bunx?)\s+(run\s+)?(dev|start|serve)\b/.test(c)) return true;
  if (/\b(next|vite|nuxt|remix|astro)\s+dev\b/.test(c)) return true;
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

export function createAgentPtyBashOperations(options?: {
  /** Optional chat/agent session id for Terminal tab grouping. */
  getAgentSessionId?: () => string | undefined;
}): BashOperations {
  const local = createLocalBashOperations();

  const ptyExec: BashOperations["exec"] = async (command, cwd, { onData, signal, env }) => {
    if (signal?.aborted) throw new Error("aborted");

    const info = await createPtySession({
      cwd,
      command,
      source: "agent",
      agentSessionId: options?.getAgentSessionId?.(),
      title: command,
      env,
      cols: 100,
      rows: 32,
      publish: true,
    });

    return await new Promise<{ exitCode: number | null }>((resolve, reject) => {
      let settled = false;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      let unsub: (() => void) | undefined;
      let sawExit = false;

      const detachTool = (exitCode: number | null, note?: string) => {
        if (settled) return;
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        try { unsub?.(); } catch { /* ignore */ }
        if (signal) signal.removeEventListener("abort", onAbort);
        if (note) {
          try {
            onData(Buffer.from(note, "utf8"));
          } catch {
            // ignore
          }
        }
        resolve({ exitCode });
      };

      const onAbort = () => {
        // User/agent abort still kills the process.
        try { destroyPtySession(info.id, "aborted"); } catch { /* ignore */ }
        if (settled) return;
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        try { unsub?.(); } catch { /* ignore */ }
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(new Error("aborted"));
      };

      try {
        unsub = subscribePtySession(info.id, (event) => {
          if (event.type === "data") {
            onData(Buffer.from(event.data, "utf8"));
          } else if (event.type === "exit") {
            sawExit = true;
            // Real process exit (crash or quick command) — return actual code.
            detachTool(event.exitCode ?? 0);
          }
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // After startup window: hand process to Terminal UI and free the agent.
      // Do NOT kill on model-provided timeouts — that was stopping npm run dev / http.server.
      startupTimer = setTimeout(() => {
        if (settled || sawExit) return;
        const still = getPtySession(info.id);
        if (!still || still.exited) {
          // Race: exit event may still arrive; wait briefly via existing sub.
          return;
        }
        detachTool(
          0,
          "\n[Pi Web] Process is running in the Terminal panel and will keep going until you stop it there (close the tab or Ctrl+C).\n",
        );
      }, LONG_RUNNING_STARTUP_MS);
      startupTimer.unref?.();
    });
  };

  return {
    exec: async (command, cwd, execOptions) => {
      // Normal short commands stay out of the Terminal UI.
      if (!looksLikeLongRunningCommand(command)) {
        return local.exec(command, cwd, execOptions);
      }
      // Long-running: ignore tool timeout for killing — process is owned by Terminal.
      return ptyExec(command, cwd, execOptions);
    },
  };
}
