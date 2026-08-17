/**
 * First-party `todo` tool for Pi Web.
 *
 * The live list is the current user turn only — a new user message starts a
 * fresh checklist. Replay and the chrome widget follow the same cut.
 */
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { formatTodoWidgetLines } from "../todo-from-transcript";

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";
export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export type Task = {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  blockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
};

export type TaskState = { tasks: Task[]; nextId: number };

type TaskDetails = {
  action: TaskAction;
  params: Record<string, unknown>;
  tasks: Task[];
  nextId: number;
  error?: string;
};

type Op =
  | { kind: "create"; taskId: number }
  | { kind: "update"; id: number; fromStatus: TaskStatus; toStatus: TaskStatus; changed: boolean }
  | { kind: "delete"; id: number; subject: string }
  | { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
  | { kind: "get"; task: Task }
  | { kind: "clear"; count: number }
  | { kind: "error"; message: string };

const EMPTY_STATE: TaskState = { tasks: [], nextId: 1 };
const store = new Map<string, TaskState>();

const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  pending: new Set(["in_progress", "completed", "deleted"]),
  in_progress: new Set(["pending", "completed", "deleted"]),
  completed: new Set(["deleted"]),
  deleted: new Set(),
};

function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].has(to);
}

function sessionKey(ctx: ExtensionContext | undefined): string {
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    if (typeof id === "string" && id) return id;
  } catch {
    // ignore
  }
  return "default";
}

function getState(key: string): TaskState {
  const cur = store.get(key);
  if (cur) return cur;
  const empty = { tasks: [] as Task[], nextId: 1 };
  store.set(key, empty);
  return empty;
}

/** Non-creating read. Do not use getState() here — it inserts an empty list. */
export function peekTodoState(sessionId: string): TaskState | undefined {
  return store.get(sessionId);
}

function setState(key: string, state: TaskState): void {
  store.set(key, state);
}

function publishTodoWidget(ctx: ExtensionContext | undefined, state: TaskState): void {
  try {
    const ui = ctx?.ui;
    if (!ui || typeof ui.setWidget !== "function") return;
    const items = state.tasks
      .filter((t) => t.status !== "deleted")
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        activeForm: t.activeForm,
      }));
    ui.setWidget("rpiv-todos", formatTodoWidgetLines(items) ?? undefined);
  } catch {
    // Session UI is optional (headless / tests).
  }
}

function isTaskDetails(value: unknown): value is TaskDetails {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

type BranchEntry = {
  id?: string;
  type?: string;
  message?: { role?: string; toolName?: string; details?: unknown };
};

const turnBySession = new Map<string, number>();
/**
 * Wall-clock ms captured at idle-input (the turn's initiating user message),
 * mirroring the subagent `beginPrompt` boundary. Steer / followUp inputs do
 * not fire `input` while idle, so they never advance this marker — the
 * checklist is not wiped mid-turn by a steer.
 */
const turnStartBySession = new Map<string, number>();

function beginTurnIfNeeded(ctx: ExtensionContext | undefined): void {
  if (!ctx) return;
  const key = sessionKey(ctx);
  const marker = turnStartBySession.get(key) ?? 0;
  if (turnBySession.get(key) === marker) return;
  turnBySession.set(key, marker);
  setState(key, { tasks: [], nextId: 1 });
}

function replayFromBranch(ctx: ExtensionContext): TaskState {
  let result: TaskState = { tasks: [], nextId: 1 };
  try {
    const branch = [...(ctx.sessionManager.getBranch?.() ?? [])] as BranchEntry[];
    let from = 0;
    for (let i = 0; i < branch.length; i++) {
      if (branch[i]?.type === "message" && branch[i]?.message?.role === "user") from = i;
    }
    for (const entry of branch.slice(from)) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
      if (!isTaskDetails(msg.details)) continue;
      result = {
        tasks: msg.details.tasks.map((t) => ({ ...t })),
        nextId: msg.details.nextId,
      };
    }
  } catch {
    // ignore replay failures
  }
  return result;
}

function detectCycle(tasks: Task[], fromId: number, blockedBy: number[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stack = [...blockedBy];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (t?.blockedBy?.length) stack.push(...t.blockedBy);
  }
  return false;
}

function deriveBlocks(tasks: Task[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const t of tasks) {
    for (const dep of t.blockedBy ?? []) {
      const list = map.get(dep) ?? [];
      list.push(t.id);
      map.set(dep, list);
    }
  }
  return map;
}

type Params = {
  action: TaskAction;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedBy?: number[];
  addBlockedBy?: number[];
  removeBlockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
  id?: number;
  includeDeleted?: boolean;
};

function applyMutation(state: TaskState, params: Params): { state: TaskState; op: Op } {
  const action = params.action;
  switch (action) {
    case "create": {
      if (!params.subject?.trim()) return { state, op: { kind: "error", message: "subject required for create" } };
      if (params.blockedBy?.length) {
        for (const dep of params.blockedBy) {
          const depTask = state.tasks.find((t) => t.id === dep);
          if (!depTask) return { state, op: { kind: "error", message: `blockedBy: #${dep} not found` } };
          if (depTask.status === "deleted") {
            return { state, op: { kind: "error", message: `blockedBy: #${dep} is deleted` } };
          }
        }
      }
      const newTask: Task = {
        id: state.nextId,
        subject: params.subject,
        status: "pending",
      };
      if (params.description) newTask.description = params.description;
      if (params.activeForm) newTask.activeForm = params.activeForm;
      if (params.blockedBy?.length) newTask.blockedBy = [...params.blockedBy];
      if (params.owner) newTask.owner = params.owner;
      if (params.metadata) newTask.metadata = { ...params.metadata };
      return {
        state: { tasks: [...state.tasks, newTask], nextId: state.nextId + 1 },
        op: { kind: "create", taskId: newTask.id },
      };
    }
    case "update": {
      if (params.id === undefined) return { state, op: { kind: "error", message: "id required for update" } };
      const idx = state.tasks.findIndex((t) => t.id === params.id);
      if (idx === -1) return { state, op: { kind: "error", message: `#${params.id} not found` } };
      const current = state.tasks[idx]!;

      const hasMutation =
        params.subject !== undefined
        || params.description !== undefined
        || params.activeForm !== undefined
        || params.status !== undefined
        || params.owner !== undefined
        || params.metadata !== undefined
        || (params.addBlockedBy && params.addBlockedBy.length > 0)
        || (params.removeBlockedBy && params.removeBlockedBy.length > 0);
      if (!hasMutation) {
        return {
          state,
          op: {
            kind: "error",
            message:
              "update requires at least one mutable field: subject, description, activeForm, status, owner, metadata, addBlockedBy, or removeBlockedBy",
          },
        };
      }

      let newStatus = current.status;
      if (params.status !== undefined) {
        if (!isTransitionValid(current.status, params.status)) {
          return {
            state,
            op: { kind: "error", message: `illegal transition ${current.status} → ${params.status}` },
          };
        }
        newStatus = params.status;
      }

      let newBlockedBy = current.blockedBy ? [...current.blockedBy] : [];
      if (params.removeBlockedBy?.length) {
        const toRemove = new Set(params.removeBlockedBy);
        newBlockedBy = newBlockedBy.filter((dep) => !toRemove.has(dep));
      }
      if (params.addBlockedBy?.length) {
        for (const dep of params.addBlockedBy) {
          if (dep === current.id) {
            return { state, op: { kind: "error", message: `cannot block #${current.id} on itself` } };
          }
          const depTask = state.tasks.find((t) => t.id === dep);
          if (!depTask) return { state, op: { kind: "error", message: `addBlockedBy: #${dep} not found` } };
          if (depTask.status === "deleted") {
            return { state, op: { kind: "error", message: `addBlockedBy: #${dep} is deleted` } };
          }
          if (!newBlockedBy.includes(dep)) newBlockedBy.push(dep);
        }
      }
      if (detectCycle(state.tasks, current.id, newBlockedBy)) {
        return { state, op: { kind: "error", message: "blockedBy cycle detected" } };
      }

      const updated: Task = {
        ...current,
        status: newStatus,
        subject: params.subject !== undefined ? params.subject : current.subject,
      };
      if (params.description !== undefined) {
        if (params.description) updated.description = params.description;
        else delete updated.description;
      }
      if (params.activeForm !== undefined) {
        if (params.activeForm) updated.activeForm = params.activeForm;
        else delete updated.activeForm;
      }
      if (params.owner !== undefined) {
        if (params.owner) updated.owner = params.owner;
        else delete updated.owner;
      }
      if (params.metadata !== undefined) {
        const nextMeta = { ...(current.metadata ?? {}) };
        for (const [k, v] of Object.entries(params.metadata)) {
          if (v === null) delete nextMeta[k];
          else nextMeta[k] = v;
        }
        if (Object.keys(nextMeta).length) updated.metadata = nextMeta;
        else delete updated.metadata;
      }
      if (newBlockedBy.length) updated.blockedBy = newBlockedBy;
      else delete updated.blockedBy;

      const changed =
        current.subject !== updated.subject
        || current.status !== updated.status
        || current.description !== updated.description
        || current.activeForm !== updated.activeForm
        || current.owner !== updated.owner
        || JSON.stringify(current.blockedBy ?? []) !== JSON.stringify(updated.blockedBy ?? [])
        || JSON.stringify(current.metadata ?? null) !== JSON.stringify(updated.metadata ?? null);

      const tasks = [...state.tasks];
      tasks[idx] = updated;
      return {
        state: { ...state, tasks },
        op: {
          kind: "update",
          id: current.id,
          fromStatus: current.status,
          toStatus: updated.status,
          changed,
        },
      };
    }
    case "delete": {
      if (params.id === undefined) return { state, op: { kind: "error", message: "id required for delete" } };
      const idx = state.tasks.findIndex((t) => t.id === params.id);
      if (idx === -1) return { state, op: { kind: "error", message: `#${params.id} not found` } };
      const current = state.tasks[idx]!;
      if (current.status === "deleted") {
        return { state, op: { kind: "error", message: `#${params.id} already deleted` } };
      }
      const tasks = [...state.tasks];
      tasks[idx] = { ...current, status: "deleted" };
      return {
        state: { ...state, tasks },
        op: { kind: "delete", id: current.id, subject: current.subject },
      };
    }
    case "clear":
      return {
        state: { tasks: [], nextId: 1 },
        op: { kind: "clear", count: state.tasks.filter((t) => t.status !== "deleted").length },
      };
    case "list":
      return {
        state,
        op: {
          kind: "list",
          statusFilter: params.status,
          includeDeleted: params.includeDeleted === true,
        },
      };
    case "get": {
      if (params.id === undefined) return { state, op: { kind: "error", message: "id required for get" } };
      const task = state.tasks.find((t) => t.id === params.id);
      if (!task) return { state, op: { kind: "error", message: `#${params.id} not found` } };
      return { state, op: { kind: "get", task } };
    }
    default:
      return { state, op: { kind: "error", message: `unknown action: ${String(action)}` } };
  }
}

function formatListLine(t: Task): string {
  const block = t.blockedBy?.length ? ` ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  const form = t.status === "in_progress" && t.activeForm ? ` (${t.activeForm})` : "";
  return `[${t.status}] #${t.id} ${t.subject}${form}${block}`;
}

function formatContent(op: Op, state: TaskState): string {
  switch (op.kind) {
    case "create": {
      const t = state.tasks.find((x) => x.id === op.taskId);
      if (!t) return `Created #${op.taskId}`;
      return `Created #${t.id}: ${t.subject} (pending)`;
    }
    case "update": {
      if (!op.changed) {
        return `No change: #${op.id} already matches the requested values (status: ${op.toStatus})`;
      }
      const transition = op.fromStatus !== op.toStatus ? ` (${op.fromStatus} → ${op.toStatus})` : "";
      return `Updated #${op.id}${transition}`;
    }
    case "delete":
      return `Deleted #${op.id}: ${op.subject}`;
    case "clear":
      return `Cleared ${op.count} tasks`;
    case "list": {
      let view = state.tasks;
      if (!op.includeDeleted) view = view.filter((t) => t.status !== "deleted");
      if (op.statusFilter) view = view.filter((t) => t.status === op.statusFilter);
      return view.length === 0 ? "No tasks" : view.map(formatListLine).join("\n");
    }
    case "get": {
      const task = op.task;
      const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
      const lines = [`#${task.id} [${task.status}] ${task.subject}`];
      if (task.description) lines.push(`  description: ${task.description}`);
      if (task.activeForm) lines.push(`  activeForm: ${task.activeForm}`);
      if (task.blockedBy?.length) {
        lines.push(`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
      }
      if (blocks.length) lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
      if (task.owner) lines.push(`  owner: ${task.owner}`);
      return lines.join("\n");
    }
    case "error":
      return `Error: ${op.message}`;
  }
}

const TodoParamsSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create"),
    Type.Literal("update"),
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("delete"),
    Type.Literal("clear"),
  ]),
  subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
  description: Type.Optional(Type.String({ description: "Long-form task description" })),
  activeForm: Type.Optional(
    Type.String({
      description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
    }),
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("in_progress"),
      Type.Literal("completed"),
      Type.Literal("deleted"),
    ], {
      description:
        "Set this task's status (update): one of pending, in_progress, completed, deleted. When action is list, filters returned tasks by this status.",
    }),
  ),
  blockedBy: Type.Optional(Type.Array(Type.Number(), { description: "Initial blockedBy ids (create only)" })),
  addBlockedBy: Type.Optional(
    Type.Array(Type.Number(), { description: "Task ids to add to blockedBy (update only, additive merge)" }),
  ),
  removeBlockedBy: Type.Optional(
    Type.Array(Type.Number(), { description: "Task ids to remove from blockedBy (update only, additive merge)" }),
  ),
  owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Arbitrary metadata; pass null value for a key to delete that key on update",
    }),
  ),
  id: Type.Optional(Type.Number({ description: "Task id (required for update, get, delete)" })),
  includeDeleted: Type.Optional(
    Type.Boolean({
      description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
    }),
  ),
});

const PROMPT_GUIDELINES = [
  "Todos are the checklist for the CURRENT user turn only. A new user message starts a fresh list — do not keep a session-long backlog.",
  "Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
  "When starting any task, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task should be in_progress at a time.",
  "Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
  "Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
  'To change a task\'s status, call update with the task id and the target status, e.g. {"action":"update","id":3,"status":"completed"} or {"action":"update","id":3,"status":"in_progress","activeForm":"writing tests"}. status is the field that changes the task; an update without a mutable field (status or another) is rejected.',
  "Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
  "list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
  "Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
];

export function createTodoInlineExtension(): InlineExtension {
  return {
    name: "todo",
    factory(pi: ExtensionAPI) {
      pi.on("session_start", async (_event, ctx) => {
        const key = sessionKey(ctx);
        beginTurnIfNeeded(ctx);
        const replayed = replayFromBranch(ctx);
        setState(key, replayed);
        turnBySession.set(key, turnStartBySession.get(key) ?? 0);
        publishTodoWidget(ctx, replayed);
      });
      pi.on("agent_start", (_event, ctx) => {
        beginTurnIfNeeded(ctx);
        publishTodoWidget(ctx, getState(sessionKey(ctx)));
      });
      pi.on("input", (_event, ctx) => {
        // Only an initiating prompt (idle) starts a fresh checklist. Steer /
        // followUp inputs arrive while busy and must not advance the turn.
        if (ctx.isIdle()) turnStartBySession.set(sessionKey(ctx), Date.now());
      });

      pi.registerTool({
        name: "todo",
        label: "Todo",
        description:
          "Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
        promptSnippet: "Manage a task list to track multi-step progress",
        promptGuidelines: PROMPT_GUIDELINES,
        parameters: TodoParamsSchema,
        async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
          const params = rawParams as Params;
          const key = sessionKey(ctx);
          beginTurnIfNeeded(ctx);
          const before = getState(key);
          const { state, op } = applyMutation(before, params);
          // Commit mutations; leave store unchanged on pure reads / validation errors.
          if (op.kind === "create" || op.kind === "update" || op.kind === "delete" || op.kind === "clear") {
            setState(key, state);
            publishTodoWidget(ctx, state);
          }
          const snapshot = op.kind === "create" || op.kind === "update" || op.kind === "delete" || op.kind === "clear"
            ? state
            : before;
          const text = formatContent(op, snapshot);
          const details: TaskDetails = {
            action: params.action,
            params: params as Record<string, unknown>,
            tasks: snapshot.tasks,
            nextId: snapshot.nextId,
            ...(op.kind === "error" ? { error: op.message } : {}),
          };
          return {
            content: [{ type: "text" as const, text }],
            details,
          };
        },
      });

      pi.registerCommand("todos", {
        description: "Show all todos on the current branch, grouped by status",
        handler: async (_args, ctx) => {
          if (!ctx.hasUI) {
            ctx.ui.notify("/todos requires interactive mode", "error");
            return;
          }
          const state = getState(sessionKey(ctx));
          const visible = state.tasks.filter((t) => t.status !== "deleted");
          if (visible.length === 0) {
            ctx.ui.notify("No todos yet. Ask the agent to add some!", "info");
            return;
          }
          const pending = visible.filter((t) => t.status === "pending");
          const inProgress = visible.filter((t) => t.status === "in_progress");
          const completed = visible.filter((t) => t.status === "completed");
          const lines: string[] = [];
          const header: string[] = [];
          if (completed.length) header.push(`${completed.length}/${visible.length} completed`);
          if (inProgress.length) header.push(`${inProgress.length} in progress`);
          if (pending.length) header.push(`${pending.length} pending`);
          lines.push(header.join(" · "));
          if (pending.length) {
            lines.push("── Pending ──");
            for (const t of pending) lines.push(`○ #${t.id} ${t.subject}`);
          }
          if (inProgress.length) {
            lines.push("── In Progress ──");
            for (const t of inProgress) {
              lines.push(`◐ #${t.id} ${t.subject}${t.activeForm ? ` (${t.activeForm})` : ""}`);
            }
          }
          if (completed.length) {
            lines.push("── Completed ──");
            for (const t of completed) lines.push(`✓ #${t.id} ${t.subject}`);
          }
          ctx.ui.notify(lines.join("\n"), "info");
        },
      });
    },
  };
}

/** Test helper */
export function __resetTodoStoreForTests(): void {
  store.clear();
  turnBySession.clear();
  turnStartBySession.clear();
  void EMPTY_STATE;
}
