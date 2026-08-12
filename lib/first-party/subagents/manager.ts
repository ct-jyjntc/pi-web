/**
 * Queue, spawn, steer, and settle native subagents for one parent session.
 */
import { randomUUID } from "crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createChildRun, type ChildRun } from "./child-session";
import type { AgentTypeConfig, SubagentRecord, SubagentStatus } from "./types";
 import { readWebSettings } from "../../web-settings";
 
 function maxConcurrent(): number {
   const cap = readWebSettings().subagentConcurrency;
   if (!cap.enabled) return Number.MAX_SAFE_INTEGER;
   return Math.max(1, Math.min(16, cap.max));
 }


type LiveRecord = SubagentRecord & {
  run?: ChildRun;
  waiters: Array<(record: SubagentRecord) => void>;
  queuedPrompt?: string;
  typeConfig: AgentTypeConfig;
  ctx: ExtensionContext;
  modelSpec?: string;
  thinkingSpec?: string;
};

export class NativeSubagentManager {
  private readonly records = new Map<string, LiveRecord>();
  private onChange: (() => void) | null = null;

  setOnChange(handler: () => void): void {
    this.onChange = handler;
  }

  list(): SubagentRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(publicRecord);
  }

  get(id: string): SubagentRecord | undefined {
    const record = this.records.get(id);
    return record ? publicRecord(record) : undefined;
  }

  runningCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.status === "running") count += 1;
    }
    return count;
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
  }): { id: string; started: Promise<SubagentRecord> } {
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
      queuedPrompt: atCapacity ? input.prompt : undefined,
      typeConfig: input.type,
      ctx: input.ctx,
      modelSpec: input.modelSpec,
      thinkingSpec: input.thinkingSpec,
    };
    this.records.set(id, record);
    this.emit();

    const started = atCapacity
      ? new Promise<SubagentRecord>((resolve) => {
        record.waiters.push(resolve);
      })
      : this.start(record, input.prompt);

    return { id, started };
  }

  async wait(id: string): Promise<SubagentRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Agent not found: "${id}"`);
    if (isTerminal(record.status)) return publicRecord(record);
    return new Promise((resolve) => {
      record.waiters.push(resolve);
    });
  }

  async steer(id: string, message: string): Promise<string> {
    const record = this.records.get(id);
    if (!record) return `Agent not found: "${id}".`;
    if (record.status !== "running" || !record.run) {
      return `Agent "${id}" is not running (status: ${record.status}). Cannot steer.`;
    }
    await record.run.steer(message);
    return `Steering message delivered to ${id}.`;
  }

  async abort(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.status === "queued") {
      this.finish(record, "stopped", undefined, "Stopped before start.");
      return true;
    }
    if (record.run) await record.run.abort();
    this.finish(record, "aborted", record.result, "Aborted.");
    return true;
  }

  async abortAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.abort(id)));
  }

  private async start(record: LiveRecord, prompt: string): Promise<SubagentRecord> {
    record.status = "running";
    record.startedAt = Date.now();
    this.emit();
    try {
      const run = await createChildRun(record.ctx, record.typeConfig, record.modelSpec, record.thinkingSpec);
      record.run = run;
      run.setActivity((text) => {
        record.activity = text;
        this.emit();
      });
      const result = await run.prompt(prompt);
      this.finish(record, "completed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(record, "error", undefined, message);
    }
    return publicRecord(record);
  }

  private finish(
    record: LiveRecord,
    status: SubagentStatus,
    result?: string,
    error?: string,
  ): void {
    if (isTerminal(record.status)) return;
    record.status = status;
    record.result = result;
    record.error = error;
    record.completedAt = Date.now();
    record.activity = undefined;
    try {
      record.run?.dispose();
    } catch {
      // Child already gone.
    }
    record.run = undefined;
    const snapshot = publicRecord(record);
    for (const waiter of record.waiters.splice(0)) waiter(snapshot);
    this.emit();
    this.pumpQueue();
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

function isTerminal(status: SubagentStatus): boolean {
  return status === "completed" || status === "error" || status === "stopped" || status === "aborted";
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
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    note: record.note,
  };
}
