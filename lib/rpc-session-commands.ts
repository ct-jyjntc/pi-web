/**
 * RPC command dispatch for AgentSessionWrapper.
 */

import { createLocalBashOperations, SessionManager } from "@earendil-works/pi-coding-agent";
import { getSubagentHost } from "./first-party/subagents/host";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";

import { parseAgentMode } from "./agent-mode";
import { agentModeBrief } from "./agent-mode-brief";
import { resolveContextUsageForUi } from "./context-usage";
import { persistGlobalAgentMode } from "./global-agent-mode";
import { buildQueryMemoryContext } from "./memory-context";
import { invalidateModelsCache } from "./models-cache";
import type { AgentSessionLike } from "./pi-types";
import { withProjectCommandEnvironment } from "./project-command-env";
import type { AgentSessionWrapper } from "./rpc-session-wrapper";
import { foldProjections } from "./session-projections";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { applyRepairToMessages } from "./session-tool-repair";
import {
  AGENT_MODE_BRIEF_CUSTOM_TYPE,
  MEMORY_CONTEXT_CUSTOM_TYPE,
  type AgentMessage,
  type ExtensionUiResponse,
} from "./types";
import { invalidateUtilityModelRuntimes } from "./utility-model";
import { beginAgentTurn, sealAgentTurn } from "./workspace-turn-journal";

function resolveSessionContextUsage(session: AgentSessionLike) {
  const messages = (session as AgentSessionLike & { messages?: unknown[] }).messages;
  return resolveContextUsageForUi(session.getContextUsage(), messages);
}

/** RPC command dispatch for AgentSessionWrapper. */
export async function dispatchRpcSessionCommand(
  wrapper: AgentSessionWrapper,
  type: string,
  command: Record<string, unknown>,
): Promise<unknown> {
  switch (type) {
    case "prompt": {
      if (!wrapper.isAlive()) throw new Error("Session destroyed");
      if (wrapper.abortRequested) {
        try { await wrapper.inner.abort(); } catch { /* killed */ }
        wrapper.abortRequested = false;
        wrapper.promptRunning = false;
      }
      if (wrapper.inner.isBashRunning) {
        throw new Error("Cannot send a prompt while a shell command is running");
      }
      // Reject concurrent prompts (multi-tab / overlapping POSTs). Steer/follow_up
      // remain available for mid-turn queueing via their own commands.
      if (wrapper.promptRunning || wrapper.inner.isStreaming || wrapper.inner.isCompacting) {
        throw new Error("Cannot send a prompt while the session is busy");
      }
      const msgs = (wrapper.inner.agent.state?.messages ?? []) as AgentMessage[];
      const { persist, nextMessages } = applyRepairToMessages(msgs);
      for (const closer of persist) {
        wrapper.inner.sessionManager.appendMessage(
          closer as Parameters<SessionManager["appendMessage"]>[0],
        );
      }
      if (persist.length && wrapper.inner.agent.state) {
        wrapper.inner.agent.state.messages = nextMessages;
      }
      // Fire and forget — events come via subscribe
      const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
      const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
      // Hermes-style query-aware recall: facts relevant to THIS message go to
      // the model as a hidden nextTurn custom message — the LLM sees them via
      // convertToLlm, but they never render in the transcript. Skipped when
      // tools (and thus memory) are fully disabled for the session.
      if (!wrapper.forceEmptySystemPrompt && typeof command.message === "string") {
        try {
          const memoryContext = buildQueryMemoryContext(wrapper.cwd, command.message);
          if (memoryContext && memoryContext !== wrapper.lastMemoryContextBlock) {
            wrapper.lastMemoryContextBlock = memoryContext;
            await wrapper.inner.sendCustomMessage(
              { customType: MEMORY_CONTEXT_CUSTOM_TYPE, content: memoryContext, display: false },
              { deliverAs: "nextTurn" },
            );
          }
        } catch (error) {
          // Memory recall must never block a prompt.
          console.error("[pi-web] memory context injection failed:", error instanceof Error ? error.message : error);
        }
      }
      // Tell the model what the mode expects of it. Delivered once per switch
      // into the mode rather than per turn, so a long plan session doesn't
      // accumulate copies of the same brief in context.
      if (!wrapper.forceEmptySystemPrompt) {
        const brief = agentModeBrief(wrapper.mode);
        if (brief && wrapper.briefedMode !== wrapper.mode) {
          try {
            wrapper.briefedMode = wrapper.mode;
            await wrapper.inner.sendCustomMessage(
              { customType: AGENT_MODE_BRIEF_CUSTOM_TYPE, content: brief, display: false },
              { deliverAs: "nextTurn" },
            );
          } catch (error) {
            console.error("[pi-web] agent mode brief injection failed:", error instanceof Error ? error.message : error);
          }
        }
      }
      if (wrapper.abortRequested) {
        wrapper.emit({ type: "prompt_done" });
        return null;
      }
      wrapper.promptRunning = true;
      try {
        // Capture the pre-prompt leaf so /undo can navigate_tree back here
        // (before this user turn + assistant replies).
        let leafId: string | undefined;
        try {
          const sm = wrapper.inner.sessionManager as {
            getLeafId?: () => string | null;
            getLeafEntry?: () => { id?: string } | null;
          };
          leafId = sm.getLeafId?.() ?? sm.getLeafEntry?.()?.id ?? undefined;
        } catch {
          leafId = undefined;
        }
        beginAgentTurn(wrapper.inner.sessionId, leafId ? { userEntryId: leafId } : undefined);
      } catch {
        // Journal open is best-effort.
      }
      wrapper.inner.prompt(command.message as string, {
        ...(promptImages?.length ? { images: promptImages } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
        source: "rpc",
      }).then(() => {
        wrapper.promptRunning = false;
        wrapper.resetIdleTimer();
        // Seal if agent_end was missed (e.g. no model stream).
        try {
          sealAgentTurn(wrapper.inner.sessionId);
        } catch {
          // ignore
        }
        if (!wrapper.isAlive()) return;
        if (!streamingBehavior) wrapper.emit({ type: "prompt_done" });
      }).catch((error) => {
        wrapper.promptRunning = false;
        wrapper.resetIdleTimer();
        try {
          sealAgentTurn(wrapper.inner.sessionId);
        } catch {
          // ignore
        }
        if (!wrapper.isAlive()) return;
        invalidateSessionListCache();
        wrapper.emit({
          type: "prompt_error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        if (!streamingBehavior) wrapper.emit({ type: "prompt_done" });
      });
      return null;
    }

    case "abort": {
      wrapper.abortRequested = true;
      wrapper.cancelPendingExtensionUi();
      const recalled = wrapper.recallQueue();
      if (wrapper.inner.isBashRunning) wrapper.inner.abortBash();
      try { wrapper.inner.abortCompaction(); } catch { /* ignore */ }
      wrapper.promptRunning = false;
      // Kill now — do not waitForIdle. Stop must return like kill(1).
      void wrapper.inner.abort().catch(() => {});
      wrapper.emit({ type: "prompt_done" });
      return recalled;
    }

    case "get_state": {
      const model = wrapper.inner.model;
      const contextUsage = resolveSessionContextUsage(wrapper.inner);
      return {
        sessionId: wrapper.inner.sessionId,
        sessionFile: wrapper.inner.sessionFile ?? "",
        isStreaming: wrapper.isStreaming,
        isPromptRunning: wrapper.promptRunning && !wrapper.abortRequested,
        isBashRunning: wrapper.inner.isBashRunning && !wrapper.abortRequested,
        isCompacting: wrapper.inner.isCompacting && !wrapper.abortRequested,
        autoCompactionEnabled: wrapper.inner.autoCompactionEnabled,
        autoRetryEnabled: wrapper.inner.autoRetryEnabled,
        model: model ? { id: model.id, provider: model.provider } : undefined,
        pendingMessageCount: wrapper.inner.pendingMessageCount,
        queuedMessages: {
          steering: [...wrapper.inner.getSteeringMessages()],
          followUp: [...wrapper.inner.getFollowUpMessages()],
        },
        contextUsage,
        projections: foldProjections({
          sessionId: wrapper.inner.sessionId,
          title: wrapper.inner.sessionManager.getSessionName() ?? null,
          messages: wrapper.inner.agent.state?.messages ?? [],
          contextPressure: contextUsage ?? null,
          sessionFile: wrapper.inner.sessionFile,
        }),
        thinkingLevel: wrapper.inner.agent.state?.thinkingLevel ?? "off",
        systemPrompt: wrapper.inner.agent.state?.systemPrompt ?? "",
        mode: wrapper.mode,
        extensionStatuses: wrapper.getExtensionStatuses(),
        extensionWidgets: wrapper.getExtensionWidgets(),
      };
    }

    case "set_model": {
      const { provider, modelId } = command as { provider: string; modelId: string };
      let model = wrapper.inner.modelRuntime.getModel(provider, modelId);
      if (!model) {
        // Reload models.json / providers so newly configured models appear.
        await wrapper.inner.modelRuntime.refresh({ allowNetwork: false });
        model = wrapper.inner.modelRuntime.getModel(provider, modelId);
      }
      if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
      await wrapper.inner.setModel(model);
      invalidateModelsCache();
      invalidateUtilityModelRuntimes();
      invalidateSessionListCache();
      return { id: model.id, provider: model.provider };
    }

    case "fork": {
      if (wrapper.inner.isBashRunning) {
        throw new Error("Cannot fork while a shell command is running");
      }
      if (wrapper.promptRunning || wrapper.inner.isStreaming || wrapper.inner.isCompacting) {
        throw new Error("Cannot fork while the session is busy");
      }
      const entryId = command.entryId as string;
      const sessionManager = wrapper.inner.sessionManager;
      const currentSessionFile = wrapper.inner.sessionFile;

      if (!sessionManager.isPersisted()) return { cancelled: true };
      if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

      const entry = sessionManager.getEntry(entryId);
      if (!entry) throw new Error("Invalid entry ID for forking");

      const sessionDir = sessionManager.getSessionDir();
      let newSessionFile: string;

      if (!entry.parentId) {
        // Fork before the first message: create an empty session linked to this one
        const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
        newManager.newSession({ parentSession: currentSessionFile });
        newSessionFile = newManager.getSessionFile() as string;
      } else {
        // Fork after some history: copy path up to (but not including) the fork point
        const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
        const forkedPath = sourceManager.createBranchedSession(entry.parentId);
        if (!forkedPath) throw new Error("Failed to create forked session");
        newSessionFile = forkedPath;
      }

      const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
      cacheSessionPath(newSessionId, newSessionFile);
      invalidateSessionListCache();
      await wrapper.shutdown();
      return { cancelled: false, newSessionId };
    }

    case "navigate_tree": {
      if (wrapper.inner.isBashRunning) {
        throw new Error("Cannot navigate while a shell command is running");
      }
      const result = await wrapper.inner.navigateTree(command.targetId as string, {});
      return { cancelled: result.cancelled };
    }

    case "set_thinking_level": {
      const level = command.level as string;
      wrapper.inner.setThinkingLevel(level);
      // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
      // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
      // force the state back so the compat layer can use it correctly.
      if (level === "xhigh" && (wrapper.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && wrapper.inner.agent?.state) {
        wrapper.inner.agent.state.thinkingLevel = "xhigh";
      }
      invalidateSessionListCache();
      return null;
    }

    case "compact": {
      try {
        const result = await wrapper.inner.compact(command.customInstructions as string | undefined);
        // Attach post-compaction UI usage so clients don't wait for the next reply.
        if (result && typeof result === "object") {
          return {
            ...(result as Record<string, unknown>),
            contextUsage: resolveSessionContextUsage(wrapper.inner),
          };
        }
        return result;
      } finally {
        invalidateSessionListCache();
      }
    }

    case "set_session_name": {
      const name = (command.name as string | undefined)?.trim();
      if (!name) throw new Error("Session name cannot be empty");
      wrapper.inner.setSessionName(name);
      invalidateSessionListCache();
      return null;
    }

    case "get_session_stats": {
      return {
        ...wrapper.inner.getSessionStats(),
        sessionName: wrapper.inner.sessionManager.getSessionName(),
      };
    }

    case "get_last_assistant_text": {
      return { text: wrapper.inner.getLastAssistantText() ?? "" };
    }

    case "set_auto_compaction": {
      wrapper.inner.setAutoCompactionEnabled(command.enabled as boolean);
      return null;
    }

    case "clear_queue": {
      // Full clear only: pi has no single-item dequeue, and clear+requeue
      // races against the agent loop pulling messages mid-flight.
      return wrapper.recallQueue();
    }

    case "steer": {
      const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
      await wrapper.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
      return null;
    }

    case "follow_up": {
      const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
      await wrapper.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
      return null;
    }

    case "get_commands": {
      const commands: SlashCommandInfo[] = [];
      for (const registered of wrapper.inner.extensionRunner.getRegisteredCommands()) {
        commands.push({
          name: registered.invocationName,
          description: registered.description,
          source: "extension",
          sourceInfo: registered.sourceInfo,
        });
      }
      for (const template of wrapper.inner.promptTemplates) {
        commands.push({
          name: template.name,
          description: template.description,
          source: "prompt",
          sourceInfo: template.sourceInfo,
        });
      }
      for (const skill of wrapper.inner.resourceLoader.getSkills().skills) {
        commands.push({
          name: `skill:${skill.name}`,
          description: skill.description,
          source: "skill",
          sourceInfo: skill.sourceInfo,
        });
      }
      return { commands };
    }

    case "set_tools": {
      const toolNames = command.toolNames as string[];
      wrapper.setForceEmptySystemPrompt(toolNames.length === 0);
      wrapper.adoptBaseToolNames(toolNames);
      wrapper.applyForcedEmptySystemPrompt();
      return null;
    }

    case "set_mode": {
      // Writes pi-web.json + yoloMode and applies to all live wrappers.
      const next = persistGlobalAgentMode(parseAgentMode(command.mode));
      return { mode: next };
    }


    case "reload": {
      await wrapper.waitForExtensionsBound();
      wrapper.extensionStatuses.clear();
      wrapper.extensionWidgets.clear();
      wrapper.syncProjectTrust();
      await wrapper.inner.reload();
      if (typeof wrapper.inner.bindExtensions !== "function") {
        wrapper.inner.extensionRunner.setUIContext?.(wrapper.createExtensionUiContext(), "rpc");
      }
      wrapper.applyForcedEmptySystemPrompt();
      invalidateModelsCache();
      invalidateUtilityModelRuntimes();
      return { success: true };
    }

    case "abort_compaction": {
      wrapper.inner.abortCompaction();
      return null;
    }

    case "extension_ui_response": {
      wrapper.resolveExtensionUiResponse(command as ExtensionUiResponse);
      return null;
    }

    case "extension_ui_input": {
      wrapper.handleExtensionUiInput(command.id as string, command.data as string);
      return null;
    }

    case "set_auto_retry": {
      wrapper.inner.setAutoRetryEnabled(command.enabled as boolean);
      return null;
    }

    case "bash": {
      if (wrapper.promptRunning || wrapper.inner.isStreaming || wrapper.inner.isCompacting || wrapper.inner.isBashRunning) {
        throw new Error("Cannot run a shell command while the session is busy");
      }
      const execution = wrapper.inner.executeBash(
        command.command as string,
        undefined,
        {
          excludeFromContext: command.excludeFromContext as boolean | undefined,
          // executeBash defaults to SDK-local operations (no pty routing), so
          // sanitize here too — host vars like NODE_ENV=production must not
          // leak into project shells (issue #487).
          operations: withProjectCommandEnvironment(
            createLocalBashOperations({ shellPath: wrapper.inner.settingsManager.getShellPath() }),
          ),
        },
      );
      try {
        const result = await execution;
        wrapper.persistBashOnlySession();
        return result;
      } finally {
        wrapper.resetIdleTimer();
        invalidateSessionListCache();
      }
    }

    case "abort_bash": {
      wrapper.inner.abortBash();
      return null;
    }

    case "subagent_followup": {
      const host = getSubagentHost(wrapper.sessionId || "");
      if (!host) throw new Error("No subagent host for this session");
      const childId = String(command.childSessionId ?? command.agentId ?? "");
      const message = String(command.message ?? "");
      if (!childId || !message) throw new Error("childSessionId and message are required");
      return host.deliver(childId, message);
    }

    case "subagent_interrupt": {
      const host = getSubagentHost(wrapper.sessionId || "");
      if (!host) throw new Error("No subagent host for this session");
      const childId = String(command.childSessionId ?? command.agentId ?? "");
      if (!childId) throw new Error("childSessionId is required");
      return host.interrupt(childId);
    }

    case "subagent_list": {
      const host = getSubagentHost(wrapper.sessionId || "");
      return host?.list() ?? [];
    }

    default:
      throw new Error(`Unsupported command: ${type}`);
  }
}
