/**
 * Native permission gate. Replaces @gotgenes/pi-permission-system as a factory.
 */
import type { ExtensionAPI, ExtensionContext, InlineExtension, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { evaluatePermission } from "./evaluate";

const ALLOW_ONCE = "Allow once";
const ALLOW_SESSION = "Allow for this session";
const DENY = "Deny";

export function createPermissionInlineExtension(options?: {
  uiContext?: ExtensionContext;
}): InlineExtension {
  return {
    name: "permission",
    factory(pi: ExtensionAPI) {
      const sessionAllow = new Set<string>();

      pi.on("tool_call", async (event, ctx) => {
        const toolName = event.toolName;
        const toolInput = (event.input ?? {}) as Record<string, unknown>;
        const decision = evaluatePermission({
          toolName,
          toolInput,
          cwd: ctx.cwd,
        });
        const sessionKey = `${decision.surface}:${decision.pattern || toolName}`;
        if (sessionAllow.has(sessionKey) || sessionAllow.has(`${toolName}:*`)) {
          return {};
        }
        if (decision.action === "allow") return {};
        if (decision.action === "deny") {
          return {
            block: true,
            reason: decision.reason ?? `Denied by ${decision.surface} policy${decision.pattern ? ` (${decision.pattern})` : ""}.`,
          };
        }

        const preview = previewInput(toolName, toolInput);
        const choice = await promptUser(options?.uiContext ?? ctx, toolName, preview, decision.reason);
        if (choice === ALLOW_SESSION) {
          sessionAllow.add(sessionKey);
          return {};
        }
        if (choice === ALLOW_ONCE) return {};
        return { block: true, reason: "Denied by user." };
      });
    },
  };
}

function previewInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash" && typeof input.command === "string") return input.command;
  if (typeof input.path === "string") return input.path;
  try {
    const json = JSON.stringify(input);
    return json.length > 240 ? `${json.slice(0, 240)}…` : json;
  } catch {
    return toolName;
  }
}

async function promptUser(
  ctx: ExtensionContext,
  toolName: string,
  preview: string,
  reason?: string,
): Promise<string | undefined> {
  if (!ctx.hasUI) return DENY;
  const title = reason ? `${toolName} — ${reason}` : `Allow ${toolName}?`;
  try {
    return await ctx.ui.select(`${title}\n${preview}`, [ALLOW_ONCE, ALLOW_SESSION, DENY], { signal: ctx.signal });
  } catch {
    const ok = await ctx.ui.confirm(title, preview, { signal: ctx.signal });
    return ok ? ALLOW_ONCE : DENY;
  }
}

export type { ToolCallEvent };
