/**
 * First-party subagent tools + Agents chrome. Replaces @gotgenes/pi-subagents.
 */
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { listEnabledTypeNames, loadAgentTypes, resolveAgentType } from "./catalog";
import { NativeSubagentManager } from "./manager";
import { formatAgentWidgetLines } from "./widget";
import { toolDetailsFor } from "./identity";
import {
  deliverUncollectedOnAgentEnd,
  formatRecord,
  SUBAGENT_RESULTS_CUSTOM_TYPE,
} from "./settle";
import { SUBAGENT_REPORT_CUSTOM_TYPE } from "../../types";
import { registerSubagentHost, unregisterSubagentHost } from "./host";
import { buildCatalogRecords, formatAgentList, listAgents, type AgentListScope } from "./list";

function parentConversationSeed(ctx: ExtensionContext): string {
  try {
    const entries = ctx.sessionManager.getEntries() as Array<{
      type?: string;
      message?: { role?: string; content?: unknown };
    }>;
    const parts: string[] = [];
    let used = 0;
    for (const entry of entries) {
      const message = entry.message;
      if (entry.type !== "message" || !message) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const content = message.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
            .filter((block): block is { type: string; text?: string } => !!block && typeof block === "object")
            .filter((block) => block.type === "text" && block.text)
            .map((block) => block.text)
            .join("\n")
          : "";
      if (!text.trim()) continue;
      const line = `${message.role === "user" ? "User" : "Assistant"}: ${text.trim()}`;
      if (used + line.length > 12000) break;
      parts.push(line);
      used += line.length;
    }
    if (parts.length === 0) return "";
    return `The parent conversation so far (read-only context):\n\n${parts.join("\n\n")}`;
  } catch {
    return "";
  }
}

const DESCRIPTION = [
  "Launch a specialized subagent for a self-contained task.",
  "Available types: Explore, Plan, Reviewer, general-purpose (plus any ~/.pi/agent/agents or <cwd>/.pi/agents).",
  "Use Explore for read-only search, Plan for design, Reviewer for git/patch review, general-purpose for multi-file work.",
  "Set run_in_background=true to run agents in parallel during this turn. The parent turn still collects results before it can finish.",
  "Pass resume=<agent id> with a new prompt to continue the same child conversation.",
].join(" ");

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}


export function createSubagentsInlineExtension(): InlineExtension {
  return {
    name: "subagents",
    factory(pi: ExtensionAPI) {
      const manager = new NativeSubagentManager();
      let widgetCtx: ExtensionContext | undefined;

      const publish = (): void => {
        const lines = formatAgentWidgetLines(buildCatalogRecords(
          manager,
          widgetCtx?.sessionManager.getSessionId(),
          widgetCtx?.sessionManager.getSessionFile(),
        ));
        try {
          widgetCtx?.ui.setWidget("agents", lines);
        } catch {
          // Headless / tests have no chrome.
        }
      };
      manager.setOnChange(publish);
      manager.setOnPublish((record) => {
        if (!record.sessionId) return;
        try {
          pi.events.emit("subagents:child:session-created", {
            sessionId: record.sessionId,
            parentSessionId: widgetCtx?.sessionManager.getSessionId(),
          });
        } catch {
          // Permission subscriber is optional.
        }
      });
      manager.setOnReport((record, output, delivery) => {
        const header = `Subagent report from ${record.displayName} (${record.description}).`;
        const body = [header, `Agent ID: ${record.id}`, record.sessionId ? `Session ID: ${record.sessionId}` : "", "", output]
          .filter((line, index, all) => line !== "" || all[index - 1] !== "")
          .join("\n");
        try {
          pi.sendMessage(
            { customType: SUBAGENT_REPORT_CUSTOM_TYPE, content: body, display: false },
            delivery === "quiet"
              ? { deliverAs: "nextTurn" }
              : { deliverAs: "followUp", triggerTurn: true },
          );
        } catch {
          // Parent session already gone.
        }
      });

      const bindParentAbort = (signal?: AbortSignal): void => {
        if (!signal) return;
        const onAbort = () => { void manager.abortAll(); };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      };

      pi.on("session_start", (_event, ctx) => {
        widgetCtx = ctx;
        const parentId = ctx.sessionManager.getSessionId();
        if (parentId) registerSubagentHost(parentId, manager);
        manager.hydrate(ctx);
        publish();
      });
      pi.on("input", (_event, ctx) => {
        if (ctx.isIdle()) manager.beginPrompt();
        bindParentAbort(ctx.signal);
      });
      pi.on("agent_end", async (event, ctx) => {
        bindParentAbort(ctx.signal);
        if (ctx.signal?.aborted) return;
        const delivered = await deliverUncollectedOnAgentEnd({
          manager,
          messages: event.messages,
          signal: ctx.signal,
        });
        if (!delivered || ctx.signal?.aborted) return;
        pi.sendMessage(
          { customType: SUBAGENT_RESULTS_CUSTOM_TYPE, content: delivered, display: false },
          { deliverAs: "followUp" },
        );
      });
      pi.on("session_shutdown", () => {
        const parentId = widgetCtx?.sessionManager.getSessionId();
        if (parentId) unregisterSubagentHost(parentId, manager);
        void manager.abortAll();
        widgetCtx = undefined;
      });

      pi.registerTool({
        name: "subagent",
        label: "Subagent",
        description: DESCRIPTION,
        promptSnippet: "subagent: Launch a specialized agent for a self-contained task.",
        promptGuidelines: [
          "Use the subagent tool proactively for exploration, planning, review, or work that touches 3+ files.",
          "Launch independent subtasks in parallel with run_in_background=true.",
          "Call get_subagent_result with wait=true when you need a result mid-turn. Do not treat a background launch as fire-and-forget.",
          "Each prompt must be self-contained unless you pass resume=<agent id> to continue that child.",
          "Call list_agents to recall children. interrupt_subagent stops the current turn but keeps the child.",
        ],
        parameters: Type.Object({
          prompt: Type.String({ description: "The task for the agent to perform." }),
          description: Type.String({ description: "A short (3-5 word) description shown in the UI." }),
          subagent_type: Type.String({
            description: "Agent type: Explore, Plan, Reviewer, general-purpose, or a custom ~/.pi/agent/agents name.",
          }),
          model: Type.Optional(Type.String({ description: "Optional provider/modelId override." })),
          thinking: Type.Optional(Type.String({ description: "Thinking level override." })),
          run_in_background: Type.Optional(Type.Boolean({
            description: "Return immediately so other work in this turn can run in parallel. The parent turn still collects the result before it can finish.",
          })),
          resume: Type.Optional(Type.String({ description: "Existing agent id to continue." })),
        }),
        async execute(_id, raw, signal, _onUpdate, ctx) {
          const params = raw as {
            prompt: string;
            description: string;
            subagent_type?: string;
            model?: string;
            thinking?: string;
            run_in_background?: boolean;
            resume?: string;
          };
          widgetCtx = ctx;
          if (params.resume) {
            try {
              const record = await manager.followup(params.resume, params.prompt, signal);
              if (record.status === "running") {
                return textResult(
                  `Message queued as the next turn for ${record.id}.`,
                  toolDetailsFor(record),
                );
              }
              manager.markCollected(record.id);
              return textResult(formatRecord(record), toolDetailsFor(record));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return textResult(message);
            }
          }

          const types = loadAgentTypes(ctx.cwd);
          const resolved = resolveAgentType(params.subagent_type, types);
          const { id } = manager.spawn({
            ctx,
            type: resolved.type,
            prompt: params.prompt,
            description: params.description,
            note: resolved.note,
            modelSpec: params.model,
            thinkingSpec: params.thinking,
            background: params.run_in_background === true,
            mode: "continuable",
            depth: 1,
          });

          if (params.run_in_background) {
            const published = await manager.waitPublished(id, signal);
            const names = listEnabledTypeNames(types).join(", ");
            return textResult([
              resolved.note,
              `Agent started: ${id}`,
              published.sessionId ? `Session ID: ${published.sessionId}` : "",
              `Type: ${resolved.type.displayName}`,
              `Description: ${params.description}`,
              `Available types: ${names}`,
              "Use get_subagent_result (wait: true) to collect the result mid-turn. resume=<agent id> continues this child. If you finish without collecting, results are delivered automatically and the turn continues.",
            ].filter(Boolean).join("\n"), toolDetailsFor(published));
          }

          const record = await manager.wait(id, signal);
          manager.markCollected(id);
          return textResult(formatRecord(record), toolDetailsFor(record));
        },
      });

      pi.registerTool({
        name: "get_subagent_result",
        label: "Subagent result",
        description: "Get a subagent's status or wait for its result.",
        promptSnippet: "get_subagent_result: Read or wait for a subagent result",
        parameters: Type.Object({
          agent_id: Type.String({ description: "Agent id returned by subagent." }),
          wait: Type.Optional(Type.Boolean({ description: "Wait until the agent finishes." })),
        }),
        async execute(_id, raw, signal) {
          const params = raw as { agent_id: string; wait?: boolean };
          const current = manager.get(params.agent_id);
          if (!current) return textResult(`Agent not found: "${params.agent_id}".`);
          const record = params.wait ? await manager.wait(params.agent_id, signal) : current;
          manager.markCollected(params.agent_id);
          return textResult(formatRecord(record), toolDetailsFor(record));
        },
      });

      pi.registerTool({
        name: "steer_subagent",
        label: "Steer subagent",
        description: "Send a mid-run message to a running subagent.",
        promptSnippet: "steer_subagent: Redirect a running subagent",
        parameters: Type.Object({
          agent_id: Type.String({ description: "Running agent id." }),
          message: Type.String({ description: "Steering message." }),
        }),
        async execute(_id, raw) {
          const params = raw as { agent_id: string; message: string };
          return textResult(await manager.steer(params.agent_id, params.message));
        },
      });

      pi.registerTool({
        name: "list_agents",
        label: "List agents",
        description:
          "List continuable background subagents. Use it to recall ids, not to poll for completion. "
          + "running = working now; idle = loaded between turns; ready = stored and resumable, not a result to collect. "
          + "send_message is allowed for depth-1 children. Scope descendants walks the tree below you.",
        promptSnippet: "list_agents: List child agents in this session",
        parameters: Type.Object({
          scope: Type.Optional(Type.String({
            description: "children (default) lists direct children; descendants walks the complete tree.",
          })),
        }),
        async execute(_id, raw, _signal, _onUpdate, ctx) {
          const params = raw as { scope?: AgentListScope };
          const scope = params.scope === "descendants" ? "descendants" : "children";
          const entries = listAgents(manager, {
            scope,
            parentSessionId: ctx.sessionManager.getSessionId(),
            parentSessionFile: ctx.sessionManager.getSessionFile(),
          });
          return textResult(formatAgentList(entries, scope));
        },
      });

      const interruptExecute = async (_id: string, raw: unknown) => {
        const params = raw as { agent_id?: string; subagent_id?: string };
        return textResult(await manager.interrupt(params.agent_id || params.subagent_id || ""));
      };

      pi.registerTool({
        name: "send_message",
        label: "Send message",
        description:
          "Send a message to a background subagent by id, continuing the same conversation. If it is still working, the message waits until its current turn finishes. This call returns no answer from the subagent — only confirmation that the message was delivered.",
        promptSnippet: "send_message: Continue a background subagent",
        parameters: Type.Object({
          subagent_id: Type.String({ description: "Child id from list_agents or Session ID." }),
          message: Type.String({ description: "The message to deliver." }),
        }),
        async execute(_id, raw) {
          const params = raw as { subagent_id: string; message: string };
          try {
            const record = await manager.deliver(params.subagent_id, params.message);
            return textResult(
              `message queued as the next turn for subagent ${params.subagent_id}`,
              toolDetailsFor(record),
            );
          } catch (error) {
            return textResult(error instanceof Error ? error.message : String(error));
          }
        },
      });

      pi.registerTool({
        name: "interrupt_agent",
        label: "Interrupt agent",
        description: "Stop a subagent's current turn. The child stays available for send_message.",
        promptSnippet: "interrupt_agent: Stop a child's current turn",
        parameters: Type.Object({
          agent_id: Type.String({ description: "Running agent or session id." }),
        }),
        execute: interruptExecute,
      });

      pi.registerTool({
        name: "interrupt_subagent",
        label: "Interrupt subagent",
        description: "Alias of interrupt_agent.",
        promptSnippet: "interrupt_subagent: Stop a child's current turn",
        parameters: Type.Object({
          agent_id: Type.String({ description: "Running agent id." }),
        }),
        execute: interruptExecute,
      });

      pi.registerTool({
        name: "subagent_fork",
        label: "Fork subagent",
        description: "One-shot child that already sees this conversation. It cannot be continued.",
        promptSnippet: "subagent_fork: One-shot child with parent history",
        parameters: Type.Object({
          prompt: Type.String({ description: "The task for the forked agent." }),
          description: Type.String({ description: "A short (3-5 word) description shown in the UI." }),
          subagent_type: Type.Optional(Type.String({ description: "Agent type. Defaults to general-purpose." })),
        }),
        async execute(_id, raw, signal, _onUpdate, ctx) {
          const params = raw as { prompt: string; description: string; subagent_type?: string };
          widgetCtx = ctx;
          const types = loadAgentTypes(ctx.cwd);
          const resolved = resolveAgentType(params.subagent_type, types);
          const { id } = manager.spawn({
            ctx,
            type: resolved.type,
            prompt: params.prompt,
            description: params.description,
            note: resolved.note,
            background: false,
            mode: "one-shot",
            depth: 1,
            seed: parentConversationSeed(ctx),
          });
          const record = await manager.wait(id, signal);
          manager.markCollected(id);
          return textResult(formatRecord(record), toolDetailsFor(record));
        },
      });
    },
  };
}
