import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, Theme } from "@earendil-works/pi-coding-agent";
import { createPiWebBashToolDefinition } from "./agent-bash-pty";
import { createPiWebEditToolDefinition } from "./agent-edit-tool";
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
import { buildQueryMemoryContext } from "./memory-context";
import { buildLeanPolicyText } from "./lean-policy";
import { resolveLeanMode } from "./lean-settings";
import { createConfiguredModelRuntime } from "./model-runtime";
import { readWebSettings } from "./web-settings";
import { resolveContextUsageForUi } from "./context-usage";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { validateAgentImages } from "./image-attachments";
import { invalidateModelsCache } from "./models-cache";
import { invalidateUtilityModelRuntimes } from "./utility-model";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike } from "./pi-types";
import { MEMORY_CONTEXT_CUSTOM_TYPE, type ExtensionUiRequest, type ExtensionUiResponse, type ExtensionWidgetItem } from "./types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS } from "./custom-ui-terminal";
import { ensureSubagentSpawnEnv } from "./resolve-pi-cli";
import {
  ensureHeavyExtensionFactories,
  getBuiltinResourceLoaderOptions,
} from "./builtin-extensions";
import { ensureBuiltinPackages, migrateBuiltinPackageSettings } from "./ensure-builtin-packages";
import { ensureSubagentDelegation } from "./ensure-subagent-delegation";

// If packages spawn the Pi CLI, never use Electron as process.execPath.
ensureSubagentSpawnEnv();
ensureSubagentDelegation();
// Strip legacy settings.packages entries before any session can start.
for (const note of migrateBuiltinPackageSettings()) console.log(`[pi-web] ${note}`);
void ensureBuiltinPackages();

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

function resolveSessionContextUsage(session: AgentSessionLike) {
  const messages = (session as AgentSessionLike & { messages?: unknown[] }).messages;
  return resolveContextUsageForUi(session.getContextUsage(), messages);
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];


// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      {} as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  /** Live factory widgets that re-render via tui.requestRender(). */
  private widgetFactories = new Map<string, {
    component: CustomUiComponent;
    tui: ReturnType<typeof createHeadlessCustomUiTui>;
    placement: "aboveEditor" | "belowEditor" | "topBar";
  }>();
  private promptRunning = false;
  /** Last per-prompt memory recall block queued for this session (dedupe guard). */
  private lastMemoryContextBlock: string | null = null;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _alive = true;

  constructor(
    public readonly inner: AgentSessionLike,
    public readonly cwd: string,
  ) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  start(): void {
    // Only a subset of events should touch the idle timer. Streaming token
    // updates are frequent; resetting the 10-minute idle window on every one
    // was pure overhead (upstream 5179734).
    const IDLE_RESET_EVENT_TYPES = new Set([
      "agent_end",
      "agent_settled",
      "auto_compaction_end",
      "compaction_end",
    ]);
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      if (IDLE_RESET_EVENT_TYPES.has(event.type)) this.resetIdleTimer();
      this.emit(event);
    });
    this.resetIdleTimer();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.waitForExtensionsBound();
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in Pi Web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      // rpiv-todo keeps a process-global "active render session". In Pi Web many
      // AgentSessions share one process, so reclaim the foreground for THIS
      // session whenever we (re)bind extensions — otherwise the overlay reads
      // another session's (empty) slot and never emits a widget.
      void this.reclaimTodoForeground();
    })().catch((err) => {
      // Clear the cached promise so the next command retries the binding
      // instead of rethrowing this failure forever. Concurrent callers still
      // share the in-flight promise; only a failure clears the cache.
      this.extensionBindingPromise = null;
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    if (!this.extensionBindingPromise) {
      // No binding in flight — (re)try it now. Since a failed attempt clears
      // its cached promise, this is also the retry path after a failure.
      if (!this.extensionsBound) await this.ensureExtensionsBound();
      return;
    }
    try {
      await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  /**
   * Point @juicesharp/rpiv-todo's process-global render pointer at this session
   * so getRenderState() / the overlay factory see the right task list.
   * Best-effort: path resolution varies with install layout.
   */
  private async reclaimTodoForeground(): Promise<void> {
    const sessionId = this.inner.sessionId;
    if (!sessionId) return;
    const home = process.env.HOME ?? "";
    const candidates = [
      // Common install under ~/.pi/agent/npm (TS source loaded by jiti/tsx loaders)
      resolve(home, ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo/state/store.ts"),
      resolve(home, ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo/state/store.js"),
    ];
    for (const candidate of candidates) {
      try {
        // file:// URL for ESM dynamic import of absolute paths
        const href = pathToFileURL(candidate).href;
        const mod = await import(href);
        if (typeof mod.setActiveRenderSession === "function") {
          mod.setActiveRenderSession(sessionId);
          return;
        }
      } catch {
        // try next path
      }
    }
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A broken listener must not disrupt other listeners or the SDK.
      }
    }
  }

  private resetIdleTimer(): void {
    // Never revive timers on a destroyed wrapper (in-flight send after destroy).
    if (!this._alive) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this._alive) return;
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch((error) => {
        console.error("[pi-web] failed to shut down idle session:", error instanceof Error ? error.message : error);
      });
    }, 10 * 60 * 1000);
  }

  /**
   * Ensure the session `.jsonl` exists on disk even before the first assistant
   * message. Pi delays flush until an assistant turn; without an on-disk file,
   * idle destroy + reopen regenerates a new session id for the same path and
   * leaves the client talking to a ghost id.
   */
  ensureSessionPersisted(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = manager.getSessionFile();
    if (!sessionFile || existsSync(sessionFile)) return;

    const header = manager.getHeader();
    if (!header) return;

    const content = [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
    writeFileSync(sessionFile, content, { encoding: "utf8", flag: "wx" });

    // Mark the SDK manager as flushed so later appends use appendFileSync.
    (manager as unknown as { flushed: boolean }).flushed = true;
    cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  private persistBashOnlySession(): void {
    this.ensureSessionPersisted();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    if (!this._alive) throw new Error("Session destroyed");
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) {
      await this.waitForExtensionsBound();
      if (!this._alive) throw new Error("Session destroyed");
      // Reclaim rpiv-todo foreground before each user turn so multi-session
      // hosts don't leave the overlay bound to a different chat.
      if (type === "prompt" || type === "steer" || type === "follow_up") {
        void this.reclaimTodoForeground();
      }
    }

    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }

    switch (type) {
      case "prompt": {
        if (!this._alive) throw new Error("Session destroyed");
        if (this.inner.isBashRunning) {
          throw new Error("Cannot send a prompt while a shell command is running");
        }
        // Reject concurrent prompts (multi-tab / overlapping POSTs). Steer/follow_up
        // remain available for mid-turn queueing via their own commands.
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting) {
          throw new Error("Cannot send a prompt while the session is busy");
        }
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        // Hermes-style query-aware recall: facts relevant to THIS message go to
        // the model as a hidden nextTurn custom message — the LLM sees them via
        // convertToLlm, but they never render in the transcript. Skipped when
        // tools (and thus memory) are fully disabled for the session.
        if (!this.forceEmptySystemPrompt && typeof command.message === "string") {
          try {
            const memoryContext = buildQueryMemoryContext(this.cwd, command.message);
            if (memoryContext && memoryContext !== this.lastMemoryContextBlock) {
              this.lastMemoryContextBlock = memoryContext;
              await this.inner.sendCustomMessage(
                { customType: MEMORY_CONTEXT_CUSTOM_TYPE, content: memoryContext, display: false },
                { deliverAs: "nextTurn" },
              );
            }
          } catch (error) {
            // Memory recall must never block a prompt.
            console.error("[pi-web] memory context injection failed:", error instanceof Error ? error.message : error);
          }
        }
        this.promptRunning = true;
        this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
          source: "rpc",
        }).then(() => {
          this.promptRunning = false;
          this.resetIdleTimer();
          if (!this._alive) return;
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
        }).catch((error) => {
          this.promptRunning = false;
          this.resetIdleTimer();
          if (!this._alive) return;
          invalidateSessionListCache();
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
        });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = resolveSessionContextUsage(this.inner);
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          // Reload models.json / providers so newly configured models appear.
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateModelsCache();
        invalidateUtilityModelRuntimes();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot fork while a shell command is running");
        }
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting) {
          throw new Error("Cannot fork while the session is busy");
        }
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

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
        await this.shutdown();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot navigate while a shell command is running");
        }
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        try {
          const result = await this.inner.compact(command.customInstructions as string | undefined);
          // Attach post-compaction UI usage so clients don't wait for the next reply.
          if (result && typeof result === "object") {
            return {
              ...(result as Record<string, unknown>),
              contextUsage: resolveSessionContextUsage(this.inner),
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
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
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
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        this.syncProjectTrust();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        invalidateModelsCache();
        invalidateUtilityModelRuntimes();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      case "bash": {
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          { excludeFromContext: command.excludeFromContext as boolean | undefined },
        );
        try {
          const result = await execution;
          this.persistBashOnlySession();
          return result;
        } finally {
          this.resetIdleTimer();
          invalidateSessionListCache();
        }
      }

      case "abort_bash": {
        this.inner.abortBash();
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.inner.isBashRunning) this.inner.abortBash();
    // Abort any in-flight prompt/compaction so the SDK stops streaming (and
    // stops writing to a session file that may already be deleted).
    if (this.promptRunning || this.inner.isStreaming) {
      void this.inner.abort().catch(() => {
        // Best effort — the session is being torn down either way.
      });
    }
    if (this.inner.isCompacting) {
      try { this.inner.abortCompaction(); } catch { /* ignore */ }
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Notify SSE subscribers that this wrapper is gone before dropping them,
    // so open streams can close instead of hanging on the heartbeat.
    this.emit({ type: "session_destroyed", sessionId: this.sessionId });
    this.listeners = [];
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    for (const [, entry] of this.widgetFactories) {
      try { entry.component.dispose?.(); } catch { /* ignore */ }
    }
    this.widgetFactories.clear();
    this.extensionWidgets.clear();
    this.extensionStatuses.clear();
    try {
      // Release SDK resources (model runtime handles, etc.).
      this.inner.dispose?.();
    } catch {
      // ignore dispose errors during teardown
    } finally {
      try {
        this.onDestroyCallback?.();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Graceful shutdown: wait for extension bind, emit session_shutdown, then destroy.
   * Prefer this over destroy() for idle timeout / fork / trust teardown.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;

    this.shutdownPromise = (async () => {
      try {
        try {
          await this.waitForExtensionsBound();
        } catch (error) {
          console.error(
            "[pi-web] extension binding failed before session shutdown:",
            error instanceof Error ? error.message : error,
          );
        }
        try {
          await this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "quit" });
        } catch (error) {
          console.error(
            "[pi-web] session_shutdown extension event failed:",
            error instanceof Error ? error.message : error,
          );
        }
      } finally {
        this.destroy();
      }
    })();
    return this.shutdownPromise;
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private refreshFactoryWidget(key: string): void {
    const entry = this.widgetFactories.get(key);
    if (!entry) return;
    let lines: string[];
    try {
      lines = entry.component.render(DEFAULT_CUSTOM_UI_COLUMNS);
    } catch (error) {
      lines = [`Widget render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    // Empty render = nothing to show (todo auto-hide, agents idle). Clear the
    // client widget so the top-bar capsule disappears instead of showing "0".
    const hasContent = Array.isArray(lines) && lines.some((l) => String(l).trim().length > 0);
    if (!hasContent) {
      this.extensionWidgets.delete(key);
      this.emit({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "setWidget",
        widgetKey: key,
        widgetLines: undefined,
        widgetPlacement: entry.placement,
      } as ExtensionUiRequest as AgentEvent);
      return;
    }
    // Strip ANSI for structured parsing; keep raw for ANSI widgets.
    this.extensionWidgets.set(key, {
      key,
      lines,
      placement: entry.placement,
    });
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey: key,
      widgetLines: lines,
      widgetPlacement: entry.placement,
    } as ExtensionUiRequest as AgentEvent);
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = createHeadlessCustomUiTui(
        () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
        width,
      );
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };

      Promise.resolve()
        .then(() => factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        // In the web UI, todo + subagent chrome live in the session top bar
        // (always visible). Side-chat (btw) stays above the composer.
        const k = key.toLowerCase();
        const forceTopBar =
          k.includes("todo") || k === "rpiv-todos" || k === "agents" || k.includes("subagent");
        const forceBelow = k === "btw" || k.includes("btw");
        const placement = forceTopBar
          ? "topBar"
          : forceBelow
            ? "belowEditor"
            : (options?.placement ?? "aboveEditor");

        // Clear existing factory widget for this key.
        const existing = this.widgetFactories.get(key);
        if (existing) {
          try { existing.component.dispose?.(); } catch { /* ignore */ }
          this.widgetFactories.delete(key);
        }

        if (content === undefined) {
          this.extensionWidgets.delete(key);
          this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "setWidget",
            widgetKey: key,
            widgetLines: undefined,
            widgetPlacement: placement,
          } as ExtensionUiRequest as AgentEvent);
          return;
        }

        // Static string[] form
        if (Array.isArray(content)) {
          this.extensionWidgets.set(key, { key, lines: content, placement });
          this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "setWidget",
            widgetKey: key,
            widgetLines: content,
            widgetPlacement: placement,
          } as ExtensionUiRequest as AgentEvent);
          return;
        }

        // Factory form: (tui, theme) => Component — used by todo, subagents, etc.
        if (typeof content !== "function") return;
        try {
          const tui = createHeadlessCustomUiTui(() => {
            this.refreshFactoryWidget(key);
          }, DEFAULT_CUSTOM_UI_COLUMNS);
          const component = (content as (tui: unknown, theme: unknown) => CustomUiComponent)(
            tui,
            PLAIN_TEXT_THEME,
          );
          if (!component || typeof component.render !== "function") return;
          this.widgetFactories.set(key, { component, tui, placement });
          this.refreshFactoryWidget(key);
        } catch (error) {
          console.error(`[pi-web] setWidget factory failed for ${key}:`, error instanceof Error ? error.message : error);
        }
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in Pi Web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        for (const [, entry] of this.widgetFactories) {
          try { entry.component.dispose?.(); } catch { /* ignore */ }
        }
        this.widgetFactories.clear();
        this.syncProjectTrust();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }

  private syncProjectTrust(): void {
    try {
      const status = getProjectTrustStatus(this.cwd, getAgentDir());
      this.inner.settingsManager.setProjectTrusted?.(status.trusted);
    } catch {
      // Older SDK builds without setProjectTrusted — ignore.
    }
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

function normalizeRpcCwd(cwd: string): string {
  try {
    return realpathSync(resolve(cwd));
  } catch {
    return resolve(cwd);
  }
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

/**
 * Shut down idle (not streaming) in-process sessions so the next prompt
 * reloads system prompt extras (e.g. Lean Mode policy). Running sessions
 * are left alone so we do not kill an active turn.
 */
export async function destroyIdleRpcSessions(): Promise<number> {
  const sessions = Array.from(getRegistry().values()).filter((session) => !session.isRunning());
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

// Re-export the thin snapshot helper so existing call sites keep working.
// Implementation lives in rpc-running.ts so list/poll routes can avoid this module.
export { getRunningRpcSessionIds } from "./rpc-running";

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
    const lean = !toolsFullyDisabled ? resolveLeanMode(cwd) : null;
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
    const agentEditTool = createPiWebEditToolDefinition(cwd);
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
            getSessionId: () => {
              try { return sessionManager.getSessionId(); } catch { return undefined; }
            },
          }),
          ...createCheckpointTools({
            getSessionId: () => {
              try { return sessionManager.getSessionId(); } catch { return undefined; }
            },
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
        agentReadTool as never,
        ...(memoryTools as never[]),
        ...(extraTools as never[]),
      ],
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in Pi Web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    wrapper = new AgentSessionWrapper(inner, cwd);
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
