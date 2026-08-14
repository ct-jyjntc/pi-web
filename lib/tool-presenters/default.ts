/** Default presenter for unknown / MCP tools. */
import type { ToolPresenter, ToolPresentation } from "../tool-presentation";

export function firstStringArg(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "command", "query", "url", "pattern", "file_path"]) {
    const v = args[key];
    if (typeof v === "string" && v) return v;
  }
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export function defaultPresenter(toolName: string): ToolPresenter {
  const presentCall = (args: Record<string, unknown>): ToolPresentation => ({
    card: "generic",
    title: toolName,
    preview: firstStringArg(args),
  });
  return {
    presentCall,
    presentResult: (args) => presentCall(args),
  };
}
