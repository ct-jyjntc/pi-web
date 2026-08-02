import { homedir } from "os";
import { join } from "path";

/**
 * Resolve ~/.pi/agent (or $PI_CODING_AGENT_DIR) without importing the full
 * pi-coding-agent SDK. Used on the cold-start path (instrumentation, session
 * list, settings) so the first HTTP request does not pay the SDK module graph.
 *
 * Mirrors `@earendil-works/pi-coding-agent` `getAgentDir()`:
 *   process.env.PI_CODING_AGENT_DIR (tilde-expanded) || join(homedir(), ".pi", "agent")
 */
export function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return expandTildePath(envDir);
  return join(homedir(), ".pi", "agent");
}

function expandTildePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}
