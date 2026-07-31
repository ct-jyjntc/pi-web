/**
 * Agent tool: github — thin gh-backed PR/issue reader + virtual pr:// / issue:// refs.
 */
import { Type } from "typebox";
import { githubAction } from "./github";
import { errorResult, type ToolDefinitionLike } from "./agent-tool-types";

export function createGithubTools(cwd: string): ToolDefinitionLike[] {
  const github: ToolDefinitionLike = {
    name: "github",
    label: "github",
    description:
      "Read GitHub PRs/issues via gh CLI (read-only). Actions: status, repo, pr, issue, diff, checks, list_prs, list_issues, search, read. " +
      "Also supports virtual refs pr://N, pr://N/diff, issue://N (same as read tool).",
    promptSnippet: "Read GitHub PRs, issues, and diffs",
    promptGuidelines: [
      "Prefer github({ action: \"pr\", number: N }) or read path pr://N over scraping HTML.",
      "For patch review use action=diff or pr://N/diff.",
      "Call action=status if unsure whether gh is authenticated for this cwd.",
      "This tool is read-only — do not use it to merge, review-submit, or comment.",
    ],
    parameters: Type.Object({
      action: Type.String({
        description:
          "status | repo | pr | issue | diff | checks | list_prs | list_issues | search | read",
      }),
      number: Type.Optional(Type.Number({ description: "PR or issue number" })),
      n: Type.Optional(Type.Number({ description: "Alias of number" })),
      pr: Type.Optional(Type.Number()),
      issue: Type.Optional(Type.Number()),
      part: Type.Optional(Type.String({ description: "body | diff | checks | files | comments" })),
      owner: Type.Optional(Type.String()),
      repo: Type.Optional(Type.String()),
      repository: Type.Optional(Type.String({ description: "owner/repo" })),
      query: Type.Optional(Type.String({ description: "For search" })),
      q: Type.Optional(Type.String()),
      what: Type.Optional(Type.String({ description: "search: issues | prs | code" })),
      state: Type.Optional(Type.String({ description: "open | closed | all (list_*)" })),
      limit: Type.Optional(Type.Number()),
      ref: Type.Optional(Type.String({ description: "Virtual ref for action=read, e.g. pr://12/diff" })),
      path: Type.Optional(Type.String({ description: "Alias of ref" })),
    }),
    async execute(_id, args) {
      try {
        const action = String(args.action ?? "status");
        const result = await githubAction(cwd, action, args);
        return {
          content: [{ type: "text", text: result.text }],
          details: result.details,
          isError: !result.ok,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  return [github];
}

