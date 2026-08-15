/**
 * Single owner for Pi Web custom tool definitions (parent and subagent children).
 */
import { createPiWebBashToolDefinition } from "./agent-bash-pty";
import { createPiWebEditToolDefinition } from "./agent-edit-tool";
import { createPiWebWriteToolDefinition } from "./agent-write-tool";
import { createPiWebReadToolDefinition } from "./agent-read-tool";
import { createGithubTools } from "./agent-github-tool";
import { createAdvancedTools } from "./agent-advanced-tools";
import { createCodeIntelTools } from "./agent-code-intel-tools";
import { createDebugTools } from "./agent-debug-tools";
import { createDiagnosticsTool, createWebTools } from "./agent-extra-tools";
import { createProjectMemoryTools } from "./agent-memory-tools";
import { readWebSettings } from "./web-settings";

export const PI_WEB_REPLACEMENT_TOOL_NAMES = ["bash", "read", "edit", "write"] as const;

export type PiWebCustomToolsOptions = {
  cwd: string;
  getSessionId?: () => string | undefined;
  getAgentSessionId?: () => string | undefined;
  /** When false, skip memory / extras (session tools fully disabled). */
  extras?: boolean;
};

export function createPiWebCustomTools(options: PiWebCustomToolsOptions) {
  const { cwd, getSessionId, extras = true } = options;
  const getAgentSessionId = options.getAgentSessionId ?? getSessionId;
  const memoryTools = extras && readWebSettings().projectMemory.enabled
    ? createProjectMemoryTools(cwd)
    : [];
  const extraTools = extras
    ? [
        createDiagnosticsTool(cwd),
        ...createWebTools(),
        ...createCodeIntelTools(cwd),
        ...createDebugTools(cwd),
        ...createGithubTools(cwd),
        ...createAdvancedTools({ cwd, getSessionId }),
      ]
    : [];
  return [
    createPiWebBashToolDefinition(cwd, { getAgentSessionId }),
    createPiWebEditToolDefinition(cwd, { getSessionId }),
    createPiWebWriteToolDefinition(cwd, { getSessionId }),
    createPiWebReadToolDefinition(cwd),
    ...memoryTools,
    ...extraTools,
  ];
}

export function extraCustomToolNames(tools: Array<{ name: string }>): string[] {
  const replacements = new Set<string>(PI_WEB_REPLACEMENT_TOOL_NAMES);
  return tools.map((tool) => tool.name).filter((name) => !replacements.has(name));
}
