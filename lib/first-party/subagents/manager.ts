/**
 * Queue, spawn, follow up, interrupt, and settle native subagents for one parent.
 * A finished turn keeps the child session (idle); only abort/shutdown dispose it.
 */
import { randomUUID } from "crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath } from "../../session-reader";
import { readWebSettings } from "../../web-settings";
import { registerChildRun, unregisterChildRun } from "./host";
import { createChildRun, type ChildRun } from "./child-session";
import { listDiskChildren, type SubagentDescriptor, type SubagentMode } from "./durable";
import { loadAgentTypes, resolveAgentType } from "./catalog";
import type { AgentTypeConfig, SubagentRecord, SubagentStatus } from "./types";
import type { ReportDelivery } from "./report";

function maxConcurrent(): number {
  const cap = readWebSettings().subagentConcurrency;
  if (!cap.enabled) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.min(16, cap.max));
}

type LiveRecord = SubagentRecord & {
  run?: ChildRun;
  waiters: Array<(record: SubagentRecord) => void>;
  publishedWaiters: Array<(record: SubagentRecord) => void>;
  queuedPrompt?: string;
  typeConfig: AgentTypeConfig;
  ctx: ExtensionContext;
  modelSpec?: string;
  thinkingSpec?: string;
  epoch: number;
  /** Wall-clock ms of the parent turn that spawned/resumed this agent. */
  parentTurnStartedAt: number;
  collected: boolean;
  mode: SubagentMode;
  depth: number;
  seed?: string;
};

export class NativeSubagentManager {
  private readonly records = new Map<string, LiveRecord>();
  private onChange: (() => void) | null = null;
  private onPublish: ((record: SubagentRecord) => void) | null = null;
  private onReport: ((record: SubagentRecord, output: string, delivery: ReportDelivery) => void) | null = null;
  private promptEpoch = 0;
  private currentTurnStartedAt = 0;

  get epoch(): number {
    return this.promptEpoch;
  }

  /** Wall-clock ms of the current parent turn's start (idle-input beginPrompt). 0 until a turn begins. */
  get currentTurnStartMs(): number {
    return this.currentTurnStartedAt;
  }

  beginPrompt(): void {
    this.currentTurnStartedAt = Date.now();
    this.promptEpoch += 1;
    this.emit();
  }

  setOnChange(handler: () => void): void {
    this.onChange = handler;
  }

  setOnPublish(handler: (record: SubagentRecord) => void): void {
    this.onPublish = handler;
  }

  setOnReport(handler: (record: SubagentRecord, output: string, delivery: ReportDelivery) => void): void {
    this.onReport = handler;
  }

  list(): SubagentRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(publicRecord);
  }

  get(id: string): SubagentRecord | undefined {
    const record = this.resolveLive(id);
    return record ? publicRecord(record) : undefined;
  }

  hydrate(ctx: ExtensionContext): void {
    const parentFile = ctx.sessionManager.getSessionFile();
    const types = loadAgentTypes(ctx.cwd);
    for (const disk of listDiskChildren(parentFile)) {
      if (disk.descriptor?.mode === "one-shot") continue;
      if ([...this.records.values()].some((record) => record.sessionId === disk.sessionId)) continue;
      const resolved = resolveAgentType(disk.descriptor?.type, types);
      const id = disk.descriptor?.agentId || disk.sessionId;
      const record: LiveRecord = {
        id,
        type: resolved.type.name,
        displayName: resolved.type.displayName,
        description: disk.descriptor?.label || resolved.type.displayName,
        status: "completed",
        startedAt: Date.parse(disk.createdAt) || Date.now(),
        waiters: [],
        publishedWaiters: [],
        typeConfig: resolved.type,
        ctx,
        epoch: this.promptEpoch,
        parentTurnStartedAt: disk.descriptor?.parentTurnStartedAt ?? 0,
        collected: true,
        sessionId: disk.sessionId,
        sessionFile: disk.sessionFile,
        mode: "continuable",
        depth: disk.descriptor?.depth ?? 1,
      };
      this.records.set(id, record);
    }
    this.emit();
  }

  private resolveLive(id: string): LiveRecord | undefined {
    return this.records.get(id)
      ?? [...this.records.values()].find((record) => record.sessionId === id);
  }

  runningCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.status === "running") count += 1;
    }
    return count;
  }

  markCollected(id: string): void {
    const record = this.resolveLive(id);
    if (!record || !isTurnDone(record.status)) return;
    record.collected = true;
  }

  uncollectedInEpoch(epoch: number): SubagentRecord[] {
    return [...this.records.values()]
      .filter((record) => record.epoch === epoch && !record.collected)
      .map(publicRecord);
  }

  async waitUncollectedInEpoch(epoch: number, signal?: AbortSignal): Promise<"ok" | "aborted"> {
    const live = [...this.records.values()].filter(
      (record) => record.epoch === epoch && !record.collected && !isTurnDone(record.status),
    );
    if (live.length === 0) return signal?.aborted ? "aborted" : "ok";
    if (signal?.aborted) return "aborted";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: "ok" | "aborted") => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => finish("aborted");
      const onDone = () => {
        if (signal?.aborted) {
          finish("aborted");
          return;
        }
        if (live.every((record) => isTurnDone(record.status))) finish("ok");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      for (const record of live) record.waiters.push(onDone);
      onDone();
    });
  }

  spawn(input: {
    ctx: ExtensionContext;
    type: AgentTypeConfig;
    prompt: string;
    description: string;
    note?: string;
    modelSpec?: string;
    thinkingSpec?: string;
    background: boolean;
    mode?: SubagentMode;
    depth?: number;
    seed?: string;
  }): { id: string } {
    const id = randomUUID();
    const atCapacity = this.runningCount() >= maxConcurrent();
    const record: LiveRecord = {
      id,
      type: input.type.name,
      displayName: input.type.displayName,
      description: input.description,
      status: atCapacity ? "queued" : "running",
      startedAt: Date.now(),
      note: input.note,
      waiters: [],
      publishedWaiters: [],
      queuedPrompt: atCapacity ? input.prompt : undefined,
      typeConfig: input.type,
      ctx: input.ctx,
      modelSpec: input.modelSpec,
      thinkingSpec: input.thinkingSpec,
        epoch: this.promptEpoch,
        parentTurnStartedAt: this.currentTurnStartedAt,
      collected: false,
      mode: input.mode ?? "continuable",
      depth: input.depth ?? 1,
      seed: input.seed,
    };
    this.records.set(id, record);
    this.emit();
    if (!atCapacity) void this.start(record, input.prompt);
    return { id };
  }

  async waitPublished(id: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const record = this.resolveLive(id);
    if (!record) throw new Error(`Agent not found: "${id}"`);
    if (record.sessionId || isHardStop(record.status)) return publicRecord(record);
    return new Promise((resolve) => {
      const onAbort = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(publicRecord(record));
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
      }
      record.publishedWaiters.push((snapshot) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(snapshot);
      });
    });
  }

  async wait(id: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const record = this.resolveLive(id);
    if (!record) throw new Error(`Agent not found: "${id}"`);
    if (isTurnDone(record.status)) return publicRecord(record);
    return new Promise((resolve) => {
      const onAbort = () => { void this.abort(id); };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
      record.waiters.push((snapshot) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(snapshot);
      });
    });
  }

  private async prepareContinuation(id: string): Promise<LiveRecord> {
    const record = this.resolveLive(id);
    if (!record) throw new Error(`Agent not found: "${id}"`);
    if (record.mode === "one-shot") {
      throw new Error(`Agent "${id}" is one-shot and cannot be continued.`);
    }
    await this.ensureRun(record);
    if (!record.run) throw new Error(`Agent "${id}" cannot be continued (status: ${record.status}).`);
    record.collected = false;
    record.epoch = this.promptEpoch;
    record.parentTurnStartedAt = this.currentTurnStartedAt;
    return record;
  }

  isResident(id: string): boolean {
    return Boolean(this.resolveLive(id)?.run);
  }

  /**
   * Queue a continuation without waiting for the child turn.
   * send_message uses this; resume / human follow-up still wait via followup().
   */
  async deliver(id: string, message: string): Promise<SubagentRecord> {
    const record = await this.prepareContinuation(id);
    if (record.status === "running") {
      void record.run!.prompt(message).then(
        (result: string) => this.settleDeliveredTurn(record, "completed", result),
        (error: unknown) => this.settleDeliveredTurn(
          record,
          "error",
          undefined,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return publicRecord(record);
    }
    record.error = undefined;
    record.result = undefined;
    record.status = "running";
    record.startedAt = Date.now();
    record.completedAt = undefined;
    this.emit();
    void record.run!.prompt(message).then(
      (result: string) => this.settleDeliveredTurn(record, "completed", result),
      (error: unknown) => this.settleDeliveredTurn(
        record,
        "error",
        undefined,
        error instanceof Error ? error.message : String(error),
      ),
    );
    return publicRecord(record);
  }

  private settleDeliveredTurn(
    record: LiveRecord,
    status: SubagentStatus,
    result?: string,
    error?: string,
  ): void {
    if (isHardStop(record.status)) return;
    if (record.status === "running") {
      this.finishTurn(record, status, result, error);
      return;
    }
    record.result = result;
    record.error = error;
    record.completedAt = Date.now();
    snapshotUsage(record);
    this.emit();
  }

  async followup(id: string, message: string, signal?: AbortSignal): Promise<SubagentRecord> {
    const record = await this.prepareContinuation(id);
    if (record.status === "running") {
      await record.run!.prompt(message);
      return publicRecord(record);
    }
    record.error = undefined;
    record.result = undefined;
    record.status = "running";
    record.startedAt = Date.now();
    record.completedAt = undefined;
    this.emit();
    try {
      const result = await record.run!.prompt(message);
      if (signal?.aborted) {
        this.finishTurn(record, "aborted", result, "Aborted.");
      } else {
        this.finishTurn(record, "completed", result);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.finishTurn(record, "error", undefined, text);
    }
    return publicRecord(record);
  }

  async steer(id: string, message: string): Promise<string> {
    const record = this.resolveLive(id);
    if (!record) return `Agent not found: "${id}".`;
    if (record.status !== "running" || !record.run) {
      return `Agent "${id}" is not running (status: ${record.status}). Cannot steer.`;
    }
    await record.run.steer(message);
    return `Steering message delivered to ${id}.`;
  }

  async interrupt(id: string): Promise<string> {
    const record = this.resolveLive(id);
    if (!record) return `Agent not found: "${id}".`;
    if (record.status === "queued") {
      this.kill(record, "stopped", "Stopped before start.");
      return `Agent ${id} stopped before start.`;
    }
    if (record.status !== "running" || !record.run) {
      return `Agent "${id}" is not running (status: ${record.status}).`;
    }
    await record.run.interrupt();
    return `Interrupt requested for ${id}. The child stays available for follow-up.`;
  }

  async abort(id: string): Promise<boolean> {
    const record = this.resolveLive(id);
    if (!record) return false;
    if (record.status === "queued") {
      this.kill(record, "stopped", "Stopped before start.");
      return true;
    }
    if (record.run) {
      try { void record.run.abort(); } catch { /* already gone */ }
      record.run = undefined;
    }
    this.kill(record, "aborted", "Aborted.");
    return true;
  }

  async abortAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.abort(id)));
  }

  private descriptorFor(record: LiveRecord): SubagentDescriptor {
    return {
      version: 1,
      mode: record.mode,
      agentId: record.id,
      type: record.type,
      label: record.description,
      depth: record.depth,
      parentTurnStartedAt: record.parentTurnStartedAt,
    };
  }

  private async ensureRun(record: LiveRecord): Promise<void> {
    if (record.run) return;
    const run = await createChildRun({
      ctx: record.ctx,
      type: record.typeConfig,
      modelSpec: record.modelSpec,
      thinkingSpec: record.thinkingSpec,
      onReport: (output, delivery) => this.onReport?.(publicRecord(record), output, delivery),
      sessionFile: record.sessionFile,
      descriptor: record.sessionFile ? undefined : this.descriptorFor(record),
      depth: record.depth,
    });
    if (isHardStop(record.status)) {
      try { run.dispose(); } catch { /* already gone */ }
      return;
    }
    record.run = run;
    record.sessionId = run.sessionId;
    record.sessionFile = run.sessionFile;
    if (run.sessionId && run.sessionFile) cacheSessionPath(run.sessionId, run.sessionFile);
    const parentId = record.ctx.sessionManager.getSessionId();
    if (parentId && run.sessionId) registerChildRun(parentId, run);
    const dispose = run.dispose.bind(run);
    run.dispose = () => {
      unregisterChildRun(run.sessionId, run);
      dispose();
    };
    run.setActivity((text) => {
      if (text) record.activity = text;
      snapshotUsage(record);
      this.emit();
    });
    snapshotUsage(record);
    this.notifyPublished(record);
    this.onPublish?.(publicRecord(record));
    this.emit();
  }

  private async start(record: LiveRecord, prompt: string): Promise<void> {
    if (isHardStop(record.status)) return;
    record.status = "running";
    record.startedAt = Date.now();
    this.emit();
    try {
      await this.ensureRun(record);
      if (!record.run) return;
      const text = record.seed ? `${record.seed}\n\n${prompt}` : prompt;
      record.seed = undefined;
      const result = await record.run.prompt(text);
      this.finishTurn(record, "completed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finishTurn(record, "error", undefined, message);
    }
  }

  private finishTurn(
    record: LiveRecord,
    status: SubagentStatus,
    result?: string,
    error?: string,
  ): void {
    if (isHardStop(record.status)) return;
    record.status = status;
    record.result = result;
    record.error = error;
    record.completedAt = Date.now();
    snapshotUsage(record);
    if (record.mode === "one-shot") {
      try { record.run?.dispose(); } catch { /* already gone */ }
      record.run = undefined;
    }
    const snapshot = publicRecord(record);
    this.notifyPublished(record);
    for (const waiter of record.waiters.splice(0)) waiter(snapshot);
    this.emit();
    this.pumpQueue();
  }

  private kill(record: LiveRecord, status: "stopped" | "aborted", error: string): void {
    if (isHardStop(record.status)) return;
    record.status = status;
    record.error = error;
    record.completedAt = Date.now();
    snapshotUsage(record);
    try { record.run?.dispose(); } catch { /* already gone */ }
    record.run = undefined;
    const snapshot = publicRecord(record);
    this.notifyPublished(record);
    for (const waiter of record.waiters.splice(0)) waiter(snapshot);
    this.emit();
    this.pumpQueue();
  }

  private notifyPublished(record: LiveRecord): void {
    if (record.publishedWaiters.length === 0) return;
    const snapshot = publicRecord(record);
    for (const waiter of record.publishedWaiters.splice(0)) waiter(snapshot);
  }

  private pumpQueue(): void {
    if (this.runningCount() >= maxConcurrent()) return;
    for (const record of this.records.values()) {
      if (record.status !== "queued" || !record.queuedPrompt) continue;
      const prompt = record.queuedPrompt;
      record.queuedPrompt = undefined;
      void this.start(record, prompt);
      return;
    }
  }

  private emit(): void {
    this.onChange?.();
  }
}

function isHardStop(status: SubagentStatus): boolean {
  return status === "stopped" || status === "aborted";
}

function isTurnDone(status: SubagentStatus): boolean {
  return status === "completed" || status === "error" || isHardStop(status);
}

function publicRecord(record: LiveRecord): SubagentRecord {
  return {
    id: record.id,
    type: record.type,
    displayName: record.displayName,
    description: record.description,
    status: record.status,
    result: record.result,
    error: record.error,
    activity: record.activity,
    contextPercent: record.contextPercent,
    contextTokens: record.contextTokens,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    note: record.note,
    sessionId: record.sessionId,
    sessionFile: record.sessionFile,
    mode: record.mode,
    depth: record.depth,
    summary: record.typeConfig.description,
    parentTurnStartedAt: record.parentTurnStartedAt,
  };
}

function snapshotUsage(record: LiveRecord): void {
  const usage = record.run?.getContextUsage();
  const percent = usage?.percent;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    record.contextPercent = Math.max(0, Math.min(100, percent));
  }
  const tokens = usage?.tokens;
  if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) {
    record.contextTokens = tokens;
  }
}
