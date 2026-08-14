/**
 * In-process AgentSession wrapper: extension UI, idle shutdown.
 * RPC command dispatch lives in rpc-session-commands.ts.
 * Registry and start live in sibling modules; public API via rpc-manager.ts.
 */

import { getAgentDir, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, writeFileSync } from "fs";
import { peekAgentQueueImages, validateAgentImages } from "./image-attachments";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { getProjectTrustStatus } from "./project-trust";

import type { AgentSessionLike, ExtensionUiContextLike } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS } from "./custom-ui-terminal";
import { sealAgentTurn } from "./workspace-turn-journal";
import { dispatchRpcSessionCommand } from "./rpc-session-commands";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
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

import { agentModeStripsWriteTools, parseAgentMode, type AgentMode } from "./agent-mode";
import { readGlobalAgentMode } from "./global-agent-mode";
export type { AgentMode } from "./agent-mode";

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];


// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      // Pi 0.84 Theme requires selectedBg on the second options bag.
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
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

export function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
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
  /** @internal */
  extensionStatuses = new Map<string, string>();
  /** @internal */
  extensionWidgets = new Map<string, ExtensionWidgetItem>();
  /** Live factory widgets that re-render via tui.requestRender(). */
  private widgetFactories = new Map<string, {
    component: CustomUiComponent;
    tui: ReturnType<typeof createHeadlessCustomUiTui>;
    placement: "aboveEditor" | "belowEditor" | "topBar";
  }>();
  /** @internal */
  promptRunning = false;
  /** Set by abort; prompt checks this after any await so Stop cannot lose a race. @internal */
  abortRequested = false;
  /** Last per-prompt memory recall block queued for this session (dedupe guard). @internal */
  lastMemoryContextBlock: string | null = null;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  /** @internal */
  forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _alive = true;
  /** Full tool allow-list as last set via set_tools (incl. extension tools). */
  private baseToolNames: string[] | null = null;
  /**
   * Unified agent mode: ask / auto / plan / yolo. Loaded from the global
   * preference so a new wrapper matches the last user selection.
   * @internal
   */
  mode: AgentMode = readGlobalAgentMode();
  /** Mode whose brief the model has already been given (re-sent on each switch). @internal */
  briefedMode: AgentMode | null = null;


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
    return this._alive && !this.abortRequested && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  get isStreaming(): boolean {
    return Boolean(this._alive && !this.abortRequested && this.inner.isStreaming);
  }

  get streamingMessage(): unknown {
    return this.inner.agent?.state?.streamingMessage;
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
        // Seal workspace file mutations for /undo after the turn settles.
        try {
          sealAgentTurn(this.inner.sessionId);
        } catch {
          // Journal must never break agent_end delivery.
        }
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
      // set_tools / session-start adopt can run before factory tools land in
      // getAllTools(). Re-merge so subagent stays active; empty allow-list
      // (all tools off) is left untouched.
      if (this.baseToolNames && this.baseToolNames.length > 0) {
        this.adoptBaseToolNames(this.baseToolNames);
      }
      this.applyForcedEmptySystemPrompt();
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

  /** @internal */
  async waitForExtensionsBound(): Promise<void> {
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
    return type === "prompt" || type === "steer" || type === "follow_up"
      || type === "get_commands" || type === "set_tools";
  }

  /** @internal */
  applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }


  /** @internal */
  emit(event: AgentEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A broken listener must not disrupt other listeners or the SDK.
      }
    }
  }

  /** @internal */
  resetIdleTimer(): void {
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

  /** @internal */
  persistBashOnlySession(): void {
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
    // This prompt owns the flag so a leftover Stop cannot drop the next send,
    // but a Stop during waitForExtensions still wins after the await.
    if (type === "prompt") this.abortRequested = false;
    if (this.shouldWaitForExtensions(type)) {
      await this.waitForExtensionsBound();
      if (!this._alive) throw new Error("Session destroyed");
      if (type === "prompt" && this.abortRequested) {
        this.emit({ type: "prompt_done" });
        return null;
      }
    }

    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }

    return dispatchRpcSessionCommand(this, type, command);
  }

  /** Plan strips write tools; ask/auto/yolo keep the full allow-list. */
  private applyModeToTools(names: string[]): string[] {
    if (agentModeStripsWriteTools(this.mode)) {
      return names.filter((name) => name !== "edit" && name !== "write");
    }
    return names;
  }

  /**
   * Seed the allow-list (session start or set_tools) through the mode filter.
   *
   * Session start used to call `setActiveToolsByName` directly, which left
   * `baseToolNames` null — and `applyModeLocally` no-ops without it. Plan mode
   * then kept edit/write until the client's first set_tools landed.
   */
  adoptBaseToolNames(toolNames: string[]): void {
    this.baseToolNames = withExtensionTools(this.inner, toolNames);
    this.inner.setActiveToolsByName(this.applyModeToTools(this.baseToolNames));
  }

  /** Apply mode + tool filter without re-persisting (init / peer sync). */
  applyModeLocally(mode: AgentMode): void {
    const next = parseAgentMode(mode);
    // Re-brief on the next prompt whenever the mode actually moves.
    if (next !== this.mode) this.briefedMode = null;
    this.mode = next;
    if (this.baseToolNames) {
      this.inner.setActiveToolsByName(this.applyModeToTools(this.baseToolNames));
    }
  }

  get currentMode(): AgentMode {
    return this.mode;
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
    this.cancelPendingExtensionUi();
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

  /** Drop queued steer/follow-up so a Stop cannot be continued by leftover messages. @internal */
  recallQueue() {
    const images = peekAgentQueueImages(this.inner.agent);
    const cleared = this.inner.clearQueue();
    return {
      ...cleared,
      steeringImages: images.steering,
      followUpImages: images.followUp,
    };
  }

  /** Unblock tool_call / ask-user waits and tell the renderer to close the dialog. @internal */
  cancelPendingExtensionUi(): void {
    for (const pending of [...this.pendingUiResponses.values()]) pending.cancel();
    for (const id of [...this.activeCustomUis.keys()]) this.closeCustomUi(id, undefined);
  }

  /** @internal */
  resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  /** @internal */
  getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  /** @internal */
  getExtensionWidgets(): ExtensionWidgetItem[] {
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

  /** @internal */
  handleExtensionUiInput(id: string, data: string): void {
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
      const dismissUi = () => {
        this.emit({ type: "extension_ui_request", id, method: "dismiss" } as ExtensionUiRequest as AgentEvent);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => {
        dismissUi();
        settle(defaultValue);
      };

      if (timeout) timeoutId = setTimeout(() => { dismissUi(); settle(defaultValue); }, timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => { dismissUi(); settle(defaultValue); },
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  /** @internal */
  createExtensionUiContext(): ExtensionUiContextLike {
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

  /** @internal */
  syncProjectTrust(): void {
    try {
      const status = getProjectTrustStatus(this.cwd, getAgentDir());
      this.inner.settingsManager.setProjectTrusted?.(status.trusted);
    } catch {
      // Older SDK builds without setProjectTrusted — ignore.
    }
  }
}
