/**
 * Create or reopen one in-process child AgentSession for a native subagent.
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type ExtensionContext,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { basename, dirname, join } from "path";
import { tmpdir } from "os";
import { getAgentDir } from "../../agent-dir";
import { createConfiguredModelRuntime } from "../../model-runtime";
import { createPiWebCustomTools, extraCustomToolNames } from "../../pi-web-custom-tools";
import { SUBAGENT_TOOL_NAMES, type AgentTypeConfig } from "./types";
import { createPermissionInlineExtension } from "../permission";
import { createReportInlineExtension } from "./report";
import { agentModeStripsWriteTools, parseAgentMode } from "../../agent-mode";
import { readGlobalAgentMode } from "../../global-agent-mode";
import {
  MAX_SUBAGENT_DEPTH,
  SUBAGENT_DESCRIPTOR_TYPE,
  type SubagentDescriptor,
} from "./durable";

export type ChildRun = {
  sessionId: string;
  sessionFile?: string;
  prompt: (text: string) => Promise<string>;
  steer: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  setActivity: (listener: (text?: string) => void) => void;
  getContextUsage: () => { percent?: number | null; tokens?: number | null } | undefined;
};

export type CreateChildRunInput = {
  ctx: ExtensionContext;
  type: AgentTypeConfig;
  modelSpec?: string;
  thinkingSpec?: string;
  onReport?: (output: string) => void | Promise<void>;
  sessionFile?: string;
  descriptor?: SubagentDescriptor;
  depth?: number;
};

let sharedRuntime: Promise<ModelRuntime> | null = null;
function childModelRuntime(): Promise<ModelRuntime> {
  if (!sharedRuntime) sharedRuntime = createConfiguredModelRuntime();
  return sharedRuntime;
}

export function childSessionDir(parentFile: string | undefined, cwd: string): string {
  if (parentFile) {
    return join(dirname(parentFile), basename(parentFile, ".jsonl"), "tasks");
  }
  const encoded = cwd.replace(/[/\\]/g, "-").replace(/^[A-Za-z]:-/, "").replace(/^-+/, "");
  return join(tmpdir(), "pi-web-subagents", encoded, "tasks");
}

function collectLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") {
      const text = content.trim();
      if (text) return text;
      continue;
    }
    if (!Array.isArray(content)) continue;
    const parts: string[] = [];
    for (const block of content) {
      const item = block as { type?: string; text?: string };
      if (item.type === "text" && item.text) parts.push(item.text);
    }
    const text = parts.join("\n\n").trim();
    if (text) return text;
  }
  return "(no output)";
}

function resolveChildModel(ctx: ExtensionContext, spec?: string) {
  if (!spec) return ctx.model;
  const lower = spec.toLowerCase();
  const slash = spec.indexOf("/");
  if (slash > 0) {
    const found = ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1));
    if (found) return found;
  }
  for (const model of [...ctx.modelRegistry.getAvailable(), ...ctx.modelRegistry.getAll()]) {
    const ref = `${model.provider}/${model.id}`.toLowerCase();
    if (ref === lower || model.id.toLowerCase() === lower || model.id.toLowerCase().includes(lower)) {
      return model;
    }
  }
  return ctx.model;
}

function buildSystemPrompt(type: AgentTypeConfig, parentPrompt: string): string {
  if (type.promptMode === "replace") return type.systemPrompt;
  return [parentPrompt.trim(), type.systemPrompt.trim()].filter(Boolean).join("\n\n");
}

export async function createChildRun(input: CreateChildRunInput): Promise<ChildRun> {
  const { ctx, type } = input;
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const depth = input.depth ?? 1;
  const canNest = depth < MAX_SUBAGENT_DEPTH;
  const systemPrompt = buildSystemPrompt(type, ctx.getSystemPrompt());
  const mode = parseAgentMode(readGlobalAgentMode());

  const nestedFactory = canNest
    ? (await import("./index")).createSubagentsInlineExtension()
    : undefined;

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      createPermissionInlineExtension({ uiContext: ctx }),
      ...(input.onReport ? [createReportInlineExtension(input.onReport)] : []),
      ...(nestedFactory ? [nestedFactory] : []),
    ],
  });
  await loader.reload();

  const sessionManager = input.sessionFile
    ? SessionManager.open(input.sessionFile)
    : SessionManager.create(
      cwd,
      childSessionDir(ctx.sessionManager.getSessionFile(), cwd),
      { parentSession: ctx.sessionManager.getSessionId() },
    );

  const customTools = createPiWebCustomTools({
    cwd,
    getSessionId: () => {
      try { return sessionManager.getSessionId(); } catch { return undefined; }
    },
    getAgentSessionId: () => {
      try { return ctx.sessionManager.getSessionId(); } catch { return undefined; }
    },
  });

  const tools = [...new Set([
    ...type.tools,
    ...extraCustomToolNames(customTools),
    "report",
    ...(canNest ? SUBAGENT_TOOL_NAMES : []),
  ])];
  const active = agentModeStripsWriteTools(mode)
    ? tools.filter((name) => name !== "edit" && name !== "write")
    : tools;

  const modelRuntime = await childModelRuntime();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    resourceLoader: loader,
    modelRuntime,
    model: resolveChildModel(ctx, input.modelSpec ?? type.model),
    thinkingLevel: (input.thinkingSpec ?? type.thinking ?? ctx.thinkingLevel) as typeof ctx.thinkingLevel,
    customTools: customTools as never[],
    tools: active,
    excludeTools: canNest ? [] : [...SUBAGENT_TOOL_NAMES],
  });

  if (input.descriptor && !input.sessionFile) {
    try {
      sessionManager.appendCustomEntry(SUBAGENT_DESCRIPTOR_TYPE, input.descriptor);
    } catch {
      // Descriptor is identity metadata; a failed append must not kill the run.
    }
  }

  let activityListener: ((text?: string) => void) | undefined;
  let assistantTurns = 0;
  const unsubscribe = session.subscribe((event) => {
    const rec = event as { type?: string; toolName?: string; name?: string; message?: { role?: string } };
    if (rec.type === "tool_execution_start" || rec.type === "tool_call") {
      activityListener?.(rec.toolName || rec.name || "working");
    }
    if (rec.type === "tool_execution_end" || rec.type === "tool_result") {
      activityListener?.();
    }
    if (rec.type === "message_end" && rec.message?.role === "assistant") {
      activityListener?.();
      if (type.maxTurns && type.maxTurns > 0) {
        assistantTurns += 1;
        if (assistantTurns >= type.maxTurns) void session.abort();
      }
    }
  });

  return {
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    async prompt(text: string) {
      try {
        if (session.isStreaming) {
          await session.prompt(text, { streamingBehavior: "followUp" });
        } else {
          await session.prompt(text);
        }
      } catch {
        // abort/interrupt settles the in-flight prompt; return whatever text landed.
      }
      return collectLastAssistantText(session.messages as unknown[]);
    },
    async steer(text: string) {
      await session.steer(text);
    },
    async interrupt() {
      if (session.isIdle) return;
      await session.abort();
    },
    async abort() {
      unsubscribe();
      session.dispose();
    },
    dispose() {
      unsubscribe();
      session.dispose();
    },
    setActivity(listener) {
      activityListener = listener;
    },
    getContextUsage() {
      try {
        return (session as { getContextUsage?: () => { percent?: number | null; tokens?: number | null } }).getContextUsage?.();
      } catch {
        return undefined;
      }
    },
  };
}
