/**
 * Strips Pi Web host-runtime variables (PORT, NODE_ENV, NEXT_*) from the
 * environment handed to project shells spawned by the agent bash tool, so the
 * Electron host's own runtime config cannot leak into user projects.
 *
 * Ported from upstream 5d07375 (issue #487). The fork replaces the bash tool
 * wholesale (lib/agent-bash-pty.ts), so upstream's inline-extension helpers do
 * not apply; call sites wrap their BashOperations with
 * withProjectCommandEnvironment instead.
 */
import type { BashOperations } from "@earendil-works/pi-coding-agent";

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_");
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

/**
 * Wrap bash operations so every spawned project shell gets a sanitized
 * environment. Removed variables are passed as explicit `undefined`
 * tombstones because the PTY path (pty-sessions buildEnv) merges the env over
 * process.env and would otherwise resurrect them; child_process spawn treats
 * `undefined` env values as omitted, so both consumers behave the same.
 */
export function withProjectCommandEnvironment(
  operations: BashOperations,
  platform: NodeJS.Platform = process.platform,
): BashOperations {
  return {
    exec(command, cwd, execOptions) {
      const baseEnvironment = execOptions.env ?? process.env;
      const environment = sanitizeProjectCommandEnvironment(baseEnvironment, platform);
      for (const name of Object.keys(baseEnvironment)) {
        if (!(name in environment)) environment[name] = undefined;
      }
      return operations.exec(command, cwd, { ...execOptions, env: environment });
    },
  };
}
