/**
 * Fold todos, title, token usage, and context pressure for session GET and get_state.
 */
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "./types";
import type { ContextUsage, SessionStatsInfo } from "./pi-types";
import { peekTodoState } from "./first-party/todo-extension";
import { isRecord } from "./type-guards";

export type ProjectionTodo = {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
};

export type SessionProjections = {
  todos: ProjectionTodo[] | null;
  title: string | null;
  tokenUsage: SessionStatsInfo;
  contextPressure: ContextUsage | null;
};

export type FoldProjectionsInput = {
  sessionId: string;
  title: string | null;
  messages: AgentMessage[] | readonly unknown[] | null | undefined;
  contextPressure: ContextUsage | null;
  sessionFile?: string;
};

function asTodos(value: unknown): ProjectionTodo[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ProjectionTodo[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== "number" || typeof row.subject !== "string") continue;
    const status = row.status;
    if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "deleted") continue;
    const todo: ProjectionTodo = {
      id: row.id,
      subject: row.subject,
      status,
    };
    if (typeof row.activeForm === "string") todo.activeForm = row.activeForm;
    out.push(todo);
  }
  return out.length > 0 ? out : null;
}

function foldTodos(sessionId: string, messages: AgentMessage[]): ProjectionTodo[] | null {
  const live = peekTodoState(sessionId);
  if (live !== undefined) return asTodos(live.tasks);
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") lastUser = i;
  }
  const turn = lastUser >= 0 ? messages.slice(lastUser) : messages;
  for (let i = turn.length - 1; i >= 0; i--) {
    const msg = turn[i];
    if (msg?.role !== "toolResult") continue;
    const tr = msg as ToolResultMessage;
    if (tr.toolName && tr.toolName !== "todo") continue;
    if (!isRecord(tr.details) || !Array.isArray(tr.details.tasks)) continue;
    return asTodos(tr.details.tasks);
  }
  return null;
}

function foldTokenUsage(
  sessionId: string,
  title: string | null,
  messages: AgentMessage[],
  sessionFile: string | undefined,
  contextPressure: ContextUsage | null,
): SessionStatsInfo {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  for (const msg of messages) {
    if (msg.role === "user") userMessages += 1;
    if (msg.role === "toolResult") toolResults += 1;
    if (msg.role !== "assistant") continue;
    assistantMessages += 1;
    const assistant = msg as AssistantMessage;
    toolCalls += assistant.content.filter((c) => c.type === "toolCall").length;
    const u = assistant.usage;
    if (!u) continue;
    tokens.input += u.input ?? 0;
    tokens.output += u.output ?? 0;
    tokens.cacheRead += u.cacheRead ?? 0;
    tokens.cacheWrite += u.cacheWrite ?? 0;
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    sessionFile,
    sessionId,
    sessionName: title ?? undefined,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: messages.length,
    tokens,
    ...(contextPressure ? { contextUsage: contextPressure } : {}),
  };
}

export function foldProjections(input: FoldProjectionsInput): SessionProjections {
  const title = input.title;
  let todos: ProjectionTodo[] | null = null;
  let tokenUsage: SessionStatsInfo = {
    sessionId: input.sessionId,
    sessionName: title ?? undefined,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  try {
    todos = foldTodos(input.sessionId, Array.isArray(input.messages) ? input.messages : []);
  } catch {
    // One fold field must not fail the whole hydrate.
    todos = null;
  }
  try {
    tokenUsage = foldTokenUsage(
      input.sessionId,
      title,
      Array.isArray(input.messages) ? input.messages : [],
      input.sessionFile,
      input.contextPressure,
    );
  } catch {
    // One fold field must not fail the whole hydrate.
  }
  return { todos, title, tokenUsage, contextPressure: input.contextPressure };
}
