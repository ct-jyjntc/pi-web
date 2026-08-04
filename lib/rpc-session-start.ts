/**
 * Create or reuse an in-process AgentSession wrapper for a session id.
 * Tool assembly + system-prompt extras (memory / lean) live here only.
 */

import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiWebBashToolDefinition } from "./agent-bash-pty";
import { createPiWebEditToolDefinition } from "./agent-edit-tool";
import { createPiWebWriteToolDefinition } from "./agent-write-tool";
import { createGithubTools } from "./agent-github-tool";
import { createPiWebReadToolDefinition } from "./agent-read-tool";
import { createAdvancedTools } from "./agent-advanced-tools";
import { createCodeIntelTools } from "./agent-code-intel-tools";
import { createDebugTools } from "./agent-debug-tools";
import {
  createCheckpointTools,
  createDiagnosticsTool,
  createWebTools,
} from "./agent-extra-tools";
import { createProjectMemoryTools } from "./agent-memory-tools";
import { buildMemoryInjectBlock } from "./project-memory";
import { buildLeanPolicyText } from "./lean-policy";
import { resolveLeanMode } from "./lean-settings";
import { createConfiguredModelRuntime } from "./model-runtime";
import { readWebSettings } from "./web-settings";
import { existsSync } from "fs";
import { cacheSessionPath } from "./session-reader";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import {
  ensureHeavyExtensionFactories,
  getBuiltinResourceLoaderOptions,
} from "./builtin-extensions";
import { AgentSessionWrapper } from "./rpc-session-wrapper";
import {
  getLocks,
  getRegistry,
  getStartingSessionCwds,
  normalizeRpcCwd,
} from "./rpc-registry";

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[]
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: existing.sessionId || sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  // Refuse to open a missing session file: SessionManager.open() would silently
  // newSession() with a different id, desyncing the client and registry.
  if (sessionFile && !existsSync(sessionFile)) {
    throw new Error(`Session file not found: ${sessionFile}`);
  }

  const starting = (async () => {
    // Some extensions access the SDK's global theme even outside the terminal UI.
    initTheme();
    const agentDir = getAgentDir();
    const startingCwds = getStartingSessionCwds();
    const normalizedCwd = normalizeRpcCwd(cwd);
    startingCwds.set(normalizedCwd, (startingCwds.get(normalizedCwd) ?? 0) + 1);

    let wrapper: AgentSessionWrapper | null = null;
    try {
    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in Pi Web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    // Gate untrusted project extensions so opening a repository does not run
    // its .pi/extensions code automatically (see lib/project-trust.ts).
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const toolsFullyDisabled = toolNames?.length === 0;
    const memoryBlock = !toolsFullyDisabled ? buildMemoryInjectBlock(cwd) : null;
    // Lean Mode: portable anti-bloat policy (opt-in). Same appendSystemPromptOverride
    // as memory — do not add a second inject path.
    const lean = !toolsFullyDisabled ? resolveLeanMode() : null;
    const leanBlock = lean?.enabled ? buildLeanPolicyText(lean.intensity) : null;
    const systemPromptExtras = [memoryBlock, leanBlock].filter(
      (block): block is string => Boolean(block),
    );
    const modelRuntime = await createConfiguredModelRuntime();
    // First-party extensions: thin tools as pure factories; heavy ones as
    // prebundled ESM factories (fallback TS paths if a bundle is missing).
    // Never installed into ~/.pi/agent/npm.
    await ensureHeavyExtensionFactories();
    const builtinLoader = getBuiltinResourceLoaderOptions();
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
      resourceLoaderOptions: {
        ...builtinLoader,
        ...(systemPromptExtras.length > 0
          ? { appendSystemPromptOverride: (base: string[]) => [...base, ...systemPromptExtras] }
          : {}),
      },
    });
    // Pi Web bash tool: explicit `background` param + foreground guardrails;
    // background services run in a real PTY mirrored in the Terminal workspace
    // so the user can watch, type, or stop them.
    const agentBashTool = createPiWebBashToolDefinition(cwd, {
      getAgentSessionId: () => {
        try {
          return sessionManager.getSessionId();
        } catch {
          return undefined;
        }
      },
    });
    const getSessionId = (): string | undefined => {
      try {
        return sessionManager.getSessionId();
      } catch {
        return undefined;
      }
    };
    const agentEditTool = createPiWebEditToolDefinition(cwd, { getSessionId });
    const agentWriteTool = createPiWebWriteToolDefinition(cwd, { getSessionId });
    const agentReadTool = createPiWebReadToolDefinition(cwd);
    const memoryTools = !toolsFullyDisabled && readWebSettings().projectMemory.enabled
      ? createProjectMemoryTools(cwd)
      : [];
    const extraTools = !toolsFullyDisabled
      ? [
          createDiagnosticsTool(cwd),
          ...createWebTools(),
          ...createCodeIntelTools(cwd),
          ...createDebugTools(cwd),
          ...createGithubTools(cwd),
          ...createAdvancedTools({
            cwd,
            getSessionId,
          }),
          ...createCheckpointTools({
            getSessionId,
            getLeafId: () => {
              try {
                // Prefer the current branch leaf so rewind navigates correctly.
                const leaf = (sessionManager as { getLeafId?: () => string | null }).getLeafId?.();
                if (leaf) return leaf;
                const leafEntry = (sessionManager as { getLeafEntry?: () => { id?: string } | null }).getLeafEntry?.();
                return leafEntry?.id;
              } catch {
                return undefined;
              }
            },
          }),
        ]
      : [];
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      customTools: [
        agentBashTool as never,
        agentEditTool as never,
        agentWriteTool as never,
        agentReadTool as never,
        ...(memoryTools as never[]),
        ...(extraTools as never[]),
      ],
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    wrapper = new AgentSessionWrapper(inner, cwd);
    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in Pi Web just like in the `pi` CLI. Routed through the
    // wrapper so the agent mode's filter (plan drops edit/write) applies from turn one.
    if (toolNames && toolNames.length > 0) {
      wrapper.adoptBaseToolNames(toolNames);
    }
    try {
      const status = getProjectTrustStatus(cwd, agentDir);
      inner.settingsManager.setProjectTrusted?.(status.trusted);
    } catch {
      // ignore missing setProjectTrusted
    }
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    // Flush header (+ any early entries) so idle destroy / server restart can
    // reopen this id instead of minting a new one for the same path.
    wrapper.ensureSessionPersisted();
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    // Replace any live wrapper already registered under the real id without
    // leaking its timers/subscriptions (e.g. concurrent start under alias keys).
    const previous = registry.get(realSessionId);
    if (previous && previous !== wrapper && previous.isAlive()) {
      previous.destroy();
    }

    wrapper.onDestroy(() => {
      if (registry.get(realSessionId) === wrapper) registry.delete(realSessionId);
      // Drop request-id alias if we registered one.
      if (sessionId !== realSessionId && registry.get(sessionId) === wrapper) {
        registry.delete(sessionId);
      }
    });
    registry.set(realSessionId, wrapper);
    // When the caller keyed the start lock by a non-temp id that differs from
    // the file header id (should be rare after persist), alias for lookups.
    if (sessionId && sessionId !== realSessionId && !sessionId.startsWith("__new__")) {
      registry.set(sessionId, wrapper);
    }
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

    return { session: wrapper, realSessionId };
    } catch (error) {
      try { wrapper?.destroy(); } catch { /* ignore */ }
      throw error;
    } finally {
      const count = (startingCwds.get(normalizedCwd) ?? 1) - 1;
      if (count <= 0) startingCwds.delete(normalizedCwd);
      else startingCwds.set(normalizedCwd, count);
    }
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
