/**
 * Create and run one in-process child AgentSession for a native subagent.
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
import { SUBAGENT_TOOL_NAMES, type AgentTypeConfig } from "./types";
import { createPermissionInlineExtension } from "../permission";
import { agentModeStripsWriteTools, parseAgentMode } from "../../agent-mode";
import { readGlobalAgentMode } from "../../global-agent-mode";

export type ChildRun = {
  sessionId: string;
  prompt: (text: string) => Promise<string>;
  steer: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  setActivity: (listener: (text: string) => void) => void;
};

let sharedRuntime: Promise<ModelRuntime> | null = null;
function childModelRuntime(): Promise<ModelRuntime> {
  if (!sharedRuntime) sharedRuntime = createConfiguredModelRuntime();
  return sharedRuntime;
}

function childSessionDir(parentFile: string | undefined, cwd: string): string {
  if (parentFile) {
    return join(dirname(parentFile), basename(parentFile, ".jsonl"), "tasks");
  }
  const encoded = cwd.replace(/[/\\]/g, "-").replace(/^[A-Za-z]:-/, "").replace(/^-+/, "");
  return join(tmpdir(), "pi-web-subagents", encoded, "tasks");
}

function collectAssistantText(messages: unknown[]): string {
  const parts: string[] = [];
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown };
    if (message.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const item = block as { type?: string; text?: string };
      if (item.type === "text" && item.text) parts.push(item.text);
    }
  }
  return parts.join("\n\n").trim();
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

export async function createChildRun(
  ctx: ExtensionContext,
  type: AgentTypeConfig,
  modelSpec?: string,
  thinkingSpec?: string,
): Promise<ChildRun> {
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const systemPrompt = buildSystemPrompt(type, ctx.getSystemPrompt());
  const mode = parseAgentMode(readGlobalAgentMode());
  const tools = agentModeStripsWriteTools(mode)
    ? type.tools.filter((name) => name !== "edit" && name !== "write")
    : type.tools;
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: [createPermissionInlineExtension({ uiContext: ctx })],
  });
  await loader.reload();

  const sessionManager = SessionManager.create(
    cwd,
    childSessionDir(ctx.sessionManager.getSessionFile(), cwd),
    { parentSession: ctx.sessionManager.getSessionId() },
  );

  const modelRuntime = await childModelRuntime();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    resourceLoader: loader,
    modelRuntime,
    model: resolveChildModel(ctx, modelSpec ?? type.model),
    thinkingLevel: (thinkingSpec ?? type.thinking ?? ctx.thinkingLevel) as typeof ctx.thinkingLevel,
    tools,
    excludeTools: [...SUBAGENT_TOOL_NAMES],
  });

  let activityListener: ((text: string) => void) | undefined;
  let assistantTurns = 0;
  const unsubscribe = session.subscribe((event) => {
    const rec = event as { type?: string; toolName?: string; name?: string; message?: { role?: string } };
    if (rec.type === "tool_execution_start" || rec.type === "tool_call") {
      activityListener?.(rec.toolName || rec.name || "working");
    }
    if (rec.type === "message_end" && rec.message?.role === "assistant" && type.maxTurns && type.maxTurns > 0) {
      assistantTurns += 1;
      if (assistantTurns >= type.maxTurns) void session.abort();
    }
  });

  return {
    sessionId: session.sessionId,
    async prompt(text: string) {
      await session.prompt(text);
      return collectAssistantText(session.messages as unknown[]) || "(no output)";
    },
    async steer(text: string) {
      await session.steer(text);
    },
    async abort() {
      await session.abort();
    },
    dispose() {
      unsubscribe();
      session.dispose();
    },
    setActivity(listener) {
      activityListener = listener;
    },
  };
}
