/**
 * Minimal advanced capabilities:
 * - debug_run: run a command under a timeout (DAP-lite; not a full debugger)
 * - ttsr_rules: list/add session stream-rule reminders (TTSR-lite post-check)
 * - collab_export: create a read-only share snapshot path for a session
 */
import { randomBytes } from "crypto";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { Type } from "typebox";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { errorResult, type ToolDefinitionLike } from "./agent-tool-types";

const execFileAsync = promisify(execFile);

export type TtsrRule = {
  id: string;
  pattern: string;
  message: string;
  enabled: boolean;
};

function rulesPath(): string {
  const dir = join(getAgentDir(), "ttsr");
  mkdirSync(dir, { recursive: true });
  return join(dir, "rules.json");
}

export function loadTtsrRules(): TtsrRule[] {
  const p = rulesPath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { rules?: TtsrRule[] };
    return Array.isArray(raw.rules) ? raw.rules : [];
  } catch {
    return [];
  }
}

function saveTtsrRules(rules: TtsrRule[]): void {
  writeFileSync(rulesPath(), `${JSON.stringify({ rules }, null, 2)}\n`, "utf8");
}

/** Check text against TTSR rules; returns matched reminders. */
export function matchTtsrRules(text: string): TtsrRule[] {
  const rules = loadTtsrRules().filter((r) => r.enabled);
  const hits: TtsrRule[] = [];
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern, "i").test(text)) hits.push(rule);
    } catch {
      if (text.toLowerCase().includes(rule.pattern.toLowerCase())) hits.push(rule);
    }
  }
  return hits;
}

export function createAdvancedTools(options: {
  cwd: string;
  getSessionId?: () => string | undefined;
}): ToolDefinitionLike[] {
  const debugRun: ToolDefinitionLike = {
    name: "debug_run",
    label: "debug_run",
    description:
      "DAP-lite: run a command in the project cwd with timeout and capture stdout/stderr (not a full interactive debugger). Use for reproducing crashes with env/flags.",
    promptSnippet: "Run a command and capture output for debugging",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run" }),
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout ms (default 30000)" })),
    }),
    async execute(_id, args, signal?: AbortSignal) {
      const command = String(args.command ?? "").trim();
      if (!command) {
        return { content: [{ type: "text", text: "command is required" }], isError: true };
      }
      const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 30_000;
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
          cwd: options.cwd,
          timeout: timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
          env: process.env,
          signal,
        });
        return {
          content: [{
            type: "text",
            text: `exit=0\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          }],
        };
      } catch (error) {
        const err = error as {
          code?: number | string;
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          message?: string;
          killed?: boolean;
        };
        const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") ?? "";
        const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") ?? "";
        return {
          content: [{
            type: "text",
            text: `exit=${err.code ?? "error"}${err.killed ? " (timeout)" : ""}\n${err.message ?? ""}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          }],
          isError: true,
        };
      }
    },
  };

  const ttsr: ToolDefinitionLike = {
    name: "ttsr_rules",
    label: "ttsr_rules",
    description:
      "TTSR-lite: manage stream reminder rules (regex/pattern → message). Rules can be checked against outputs; not mid-token abort like full omp TTSR.",
    promptSnippet: "List/add/remove TTSR-lite reminder rules",
    parameters: Type.Object({
      action: Type.String({ description: "list | add | remove | check" }),
      pattern: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      text: Type.Optional(Type.String({ description: "For action=check, text to match against" })),
    }),
    async execute(_id, args) {
      const action = String(args.action ?? "list");
      if (action === "list") {
        const rules = loadTtsrRules();
        if (!rules.length) return { content: [{ type: "text", text: "No TTSR rules." }] };
        return {
          content: [{
            type: "text",
            text: rules.map((r) => `- [${r.id}] ${r.enabled ? "on" : "off"} /${r.pattern}/ → ${r.message}`).join("\n"),
          }],
          details: { rules },
        };
      }
      if (action === "add") {
        const pattern = String(args.pattern ?? "").trim();
        const message = String(args.message ?? "").trim();
        if (!pattern || !message) {
          return { content: [{ type: "text", text: "pattern and message required" }], isError: true };
        }
        const rules = loadTtsrRules();
        const rule: TtsrRule = {
          id: randomBytes(3).toString("hex"),
          pattern,
          message,
          enabled: true,
        };
        rules.push(rule);
        saveTtsrRules(rules);
        return { content: [{ type: "text", text: `Added rule ${rule.id}` }], details: rule };
      }
      if (action === "remove") {
        const id = String(args.id ?? "");
        const next = loadTtsrRules().filter((r) => r.id !== id);
        saveTtsrRules(next);
        return { content: [{ type: "text", text: `Removed ${id || "(none)"}` }] };
      }
      if (action === "check") {
        const hits = matchTtsrRules(String(args.text ?? ""));
        if (!hits.length) return { content: [{ type: "text", text: "No rules matched." }] };
        return {
          content: [{
            type: "text",
            text: hits.map((h) => `⚠ ${h.message} (/${h.pattern}/)`).join("\n"),
          }],
          details: { hits },
        };
      }
      return { content: [{ type: "text", text: "action must be list|add|remove|check" }], isError: true };
    },
  };

  const collab: ToolDefinitionLike = {
    name: "collab_share",
    label: "collab_share",
    description:
      "Collab-lite: create a read-only live share token for this session. Viewers can poll /api/collab/:token and SSE /api/collab/:token/events (no remote control).",
    promptSnippet: "Create a read-only live share link for this session",
    parameters: Type.Object({
      note: Type.Optional(Type.String()),
      sessionFile: Type.Optional(Type.String({ description: "Optional absolute session .jsonl path" })),
    }),
    async execute(_id, args) {
      const sessionId = options.getSessionId?.();
      if (!sessionId) {
        return { content: [{ type: "text", text: "No active session id" }], isError: true };
      }
      try {
        const { createCollabShare } = await import("./collab-live");
        const share = createCollabShare({
          sessionId,
          sessionFile: typeof args.sessionFile === "string" ? args.sessionFile : undefined,
          note: typeof args.note === "string" ? args.note : "",
        });
        return {
          content: [{
            type: "text",
            text: [
              "Collab read-only share created",
              `token: ${share.token}`,
              `session: ${sessionId}`,
              `GET /api/collab/${share.token}`,
              `SSE /api/collab/${share.token}/events`,
              "Viewers cannot prompt or control the agent.",
            ].join("\n"),
          }],
          details: share,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  return [debugRun, ttsr, collab];
}
