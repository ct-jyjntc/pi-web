/**
 * First-party subagent tools + Agents chrome. Replaces @gotgenes/pi-subagents.
 */
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { listEnabledTypeNames, loadAgentTypes, resolveAgentType } from "./catalog";
import { NativeSubagentManager } from "./manager";
import { formatAgentWidgetLines } from "./widget";
import {
  deliverUncollectedOnAgentEnd,
  formatRecord,
  SUBAGENT_RESULTS_CUSTOM_TYPE,
} from "./settle";

const DESCRIPTION = [
  "Launch a specialized subagent for a self-contained task.",
  "Available types: Explore, Plan, Reviewer, general-purpose (plus any ~/.pi/agent/agents or <cwd>/.pi/agents).",
  "Use Explore for read-only search, Plan for design, Reviewer for git/patch review, general-purpose for multi-file work.",
  "Set run_in_background=true to run agents in parallel during this turn. The parent turn still collects results before it can finish.",
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
        const lines = formatAgentWidgetLines(manager.listCurrent());
        try {
          widgetCtx?.ui.setWidget("agents", lines);
        } catch {
          // Headless / tests have no chrome.
        }
      };
      manager.setOnChange(publish);

      const bindParentAbort = (signal?: AbortSignal): void => {
        if (!signal) return;
        const onAbort = () => { void manager.abortAll(); };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      };

      pi.on("session_start", (_event, ctx) => {
        widgetCtx = ctx;
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
          "Each prompt must be self-contained. The child does not see this conversation.",
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
            const existing = manager.get(params.resume);
            if (!existing) return textResult(`Agent not found: "${params.resume}".`);
            manager.markCollected(params.resume);
            return textResult(formatRecord(existing));
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
          });

          try {
            pi.events.emit("subagents:child:session-created", {
              sessionId: id,
              parentSessionId: ctx.sessionManager.getSessionId(),
            });
          } catch {
            // Permission subscriber is optional.
          }

          if (params.run_in_background) {
            const names = listEnabledTypeNames(types).join(", ");
            return textResult([
              resolved.note,
              `Agent started: ${id}`,
              `Type: ${resolved.type.displayName}`,
              `Description: ${params.description}`,
              `Available types: ${names}`,
              "Use get_subagent_result (wait: true) to collect the result mid-turn. If you finish without collecting, results are delivered automatically and the turn continues.",
            ].filter(Boolean).join("\n"));
          }

          const record = await manager.wait(id, signal);
          manager.markCollected(id);
          return textResult(formatRecord(record));
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
          return textResult(formatRecord(record));
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
    },
  };
}
