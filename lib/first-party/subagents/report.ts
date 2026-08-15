/**
 * Child-scoped report tool — the child chooses what the parent should see.
 * Not a second settlement path: agent_end still collects uncollected results.
 */
import { Type } from "typebox";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export type ReportDelivery = "quiet" | "wakeup";

export function resolveReportDelivery(value: unknown): ReportDelivery {
  return value === "quiet" ? "quiet" : "wakeup";
}

export function createReportInlineExtension(
  onReport: (output: string, delivery: ReportDelivery) => void | Promise<void>,
): InlineExtension {
  return {
    name: "subagent-report",
    factory(pi) {
      pi.registerTool({
        name: "report",
        label: "Report",
        description:
          "Report selected content to the agent that started you. Call this once before you finish, with a self-contained final result, and earlier for progress that changes what that agent does next. Reporting does not end your turn. delivery=quiet injects the report for the next parent turn without waking it; wakeup (default) starts a parent turn.",
        promptSnippet: "report: Send a finding to the parent agent",
        promptGuidelines: [
          "Deliver your result with the report tool before you finish: call it once with a self-contained answer.",
          "The parent shares your workspace but does not automatically receive your transcript.",
          "Reporting never ends your turn.",
          "Use delivery=quiet when the parent should see this later without interrupting its current work.",
        ],
        parameters: Type.Object({
          output: Type.String({
            description: "Actionable content for your parent; summarize conclusions and reference relevant shared paths.",
          }),
          delivery: Type.Optional(Type.String({
            description: "wakeup (default) starts a parent turn; quiet injects for the next turn without waking.",
          })),
        }),
        async execute(_id, raw) {
          const params = raw as { output: string; delivery?: string };
          const delivery = resolveReportDelivery(params.delivery);
          await onReport(params.output, delivery);
          return {
            content: [{ type: "text" as const, text: "report accepted by the agent that started you" }],
            details: { delivery },
          };
        },
      });
    },
  };
}
