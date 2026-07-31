import { Type } from "typebox";
import { errorResult, type ToolDefinitionLike } from "./agent-tool-types";
import {
  debugBreakpoint,
  debugContinue,
  debugEvaluate,
  debugGet,
  debugLaunch,
  debugList,
  debugLogs,
  debugPause,
  debugStack,
  debugStop,
} from "./node-inspector";

export function createDebugTools(cwd: string): ToolDefinitionLike[] {
  const debug: ToolDefinitionLike = {
    name: "debug",
    label: "debug",
    description:
      "Node Inspector debugging (CDP). Actions: launch, list, continue, pause, breakpoint, evaluate, stack, logs, stop. Launch runs node with --inspect-brk.",
    promptSnippet: "Debug a Node process: breakpoints, continue, evaluate, stack",
    parameters: Type.Object({
      action: Type.String({
        description: "launch|list|continue|pause|breakpoint|evaluate|stack|logs|stop",
      }),
      command: Type.Optional(Type.String({ description: "For launch: node script or shell command" })),
      id: Type.Optional(Type.String({ description: "Debug session id" })),
      file: Type.Optional(Type.String({ description: "For breakpoint: file path" })),
      line: Type.Optional(Type.Number({ description: "For breakpoint: 1-based line" })),
      expression: Type.Optional(Type.String({ description: "For evaluate" })),
      frameIndex: Type.Optional(Type.Number({ description: "Stack frame index for evaluate (default 0)" })),
      breakOnStart: Type.Optional(Type.Boolean({ description: "launch with --inspect-brk (default true)" })),
    }),
    async execute(_id, args) {
      try {
        const action = String(args.action ?? "");
        if (action === "launch") {
          const info = await debugLaunch(cwd, String(args.command ?? ""), {
            breakOnStart: args.breakOnStart !== false,
          });
          return {
            content: [{
              type: "text",
              text: `Debug session ${info.id} ${info.status}\npid=${info.pid}\ninspect=${info.inspectUrl}\ncmd=${info.command}`,
            }],
            details: info,
          };
        }
        if (action === "list") {
          const list = debugList();
          if (!list.length) return { content: [{ type: "text", text: "No debug sessions." }] };
          return {
            content: [{
              type: "text",
              text: list.map((s) => `- ${s.id} ${s.status} pid=${s.pid} ${s.command}`).join("\n"),
            }],
            details: { sessions: list },
          };
        }
        const id = String(args.id ?? "");
        if (!id && action !== "list") {
          return { content: [{ type: "text", text: "id is required" }], isError: true };
        }
        if (action === "continue") {
          const info = await debugContinue(id);
          return { content: [{ type: "text", text: `continued ${id} → ${info.status}` }], details: info };
        }
        if (action === "pause") {
          const info = await debugPause(id);
          return { content: [{ type: "text", text: `pause requested ${id}` }], details: info };
        }
        if (action === "breakpoint") {
          const file = String(args.file ?? "");
          const line = Number(args.line);
          if (!file || !Number.isFinite(line)) {
            return { content: [{ type: "text", text: "file and line required" }], isError: true };
          }
          const result = await debugBreakpoint(id, file, line);
          return {
            content: [{ type: "text", text: `breakpoint ${result.breakpointId || "(set)"} @ ${file}:${line}` }],
            details: result,
          };
        }
        if (action === "evaluate") {
          const value = await debugEvaluate(id, String(args.expression ?? ""), Number(args.frameIndex ?? 0));
          return { content: [{ type: "text", text: value }] };
        }
        if (action === "stack") {
          const frames = await debugStack(id);
          if (!frames.length) {
            const s = debugGet(id);
            return {
              content: [{
                type: "text",
                text: `No frames (status=${s?.info.status ?? "missing"}). Process may not be paused.`,
              }],
            };
          }
          return {
            content: [{
              type: "text",
              text: frames.map((f, i) => `${i}: ${f.functionName} ${f.url}:${f.lineNumber}:${f.columnNumber}`).join("\n"),
            }],
            details: { frames },
          };
        }
        if (action === "logs") {
          return { content: [{ type: "text", text: debugLogs(id) || "(no logs)" }] };
        }
        if (action === "stop") {
          await debugStop(id);
          return { content: [{ type: "text", text: `stopped ${id}` }] };
        }
        return { content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true };
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  return [debug];
}
