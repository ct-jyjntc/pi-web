import { Type } from "typebox";
import { applyAstEdit } from "./ast-edit";
import { applyHashlineEdits, hashBlock } from "./hashline-edit";
import {
  getLspClientForFile,
  listAvailableLspServers,
  uriToPath,
} from "./lsp-client";
import { applyRenameEdits, findReferences, formatLocations, planRename } from "./ts-lsp";
import { readFileSync, writeFileSync } from "fs";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
  isError?: boolean;
};

type ToolDefinitionLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
};

function num(v: unknown, name: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export function createCodeIntelTools(cwd: string): ToolDefinitionLike[] {
  const servers: ToolDefinitionLike = {
    name: "lsp_servers",
    label: "lsp_servers",
    description: "List discovered external LSP servers available on PATH (pyright, gopls, rust-analyzer, …).",
    promptSnippet: "List available language servers",
    parameters: Type.Object({}),
    async execute() {
      const list = listAvailableLspServers();
      return {
        content: [{
          type: "text",
          text: list.length
            ? `Available LSP servers:\n${list.map((s) => `- ${s}`).join("\n")}\n\nTS/JS also has a built-in language service fallback.`
            : "No external LSP servers on PATH. TS/JS still works via built-in service.",
        }],
        details: { servers: list },
      };
    },
  };

  const hover: ToolDefinitionLike = {
    name: "lsp_hover",
    label: "lsp_hover",
    description: "Hover info at file:line:character via external LSP if available, else TS service symbol info via references context.",
    promptSnippet: "Hover documentation for a symbol",
    parameters: Type.Object({
      path: Type.String(),
      line: Type.Number(),
      character: Type.Number(),
    }),
    async execute(_id, args) {
      try {
        const path = String(args.path ?? "");
        const line = num(args.line, "line");
        const character = num(args.character, "character");
        const client = await getLspClientForFile(cwd, path);
        if (client) {
          const text = await client.hover(path, line, character);
          return { content: [{ type: "text", text }] };
        }
        // fallback: show definition-ish via TS references symbol name
        const refs = findReferences(cwd, path, line, character);
        return {
          content: [{
            type: "text",
            text: refs.symbolName
              ? `Symbol: ${refs.symbolName}\n(No external hover server; showing TS symbol name + ${refs.locations.length} refs)`
              : "No hover (install a language server or use a TS/JS symbol).",
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const definition: ToolDefinitionLike = {
    name: "lsp_definition",
    label: "lsp_definition",
    description: "Go to definition via external LSP server when available.",
    promptSnippet: "Go to definition",
    parameters: Type.Object({
      path: Type.String(),
      line: Type.Number(),
      character: Type.Number(),
    }),
    async execute(_id, args) {
      try {
        const path = String(args.path ?? "");
        const line = num(args.line, "line");
        const character = num(args.character, "character");
        const client = await getLspClientForFile(cwd, path);
        if (!client) {
          // TS fallback: first reference group declaration often first location
          const refs = findReferences(cwd, path, line, character);
          const loc = refs.locations[0];
          return {
            content: [{
              type: "text",
              text: loc
                ? `Definition (TS service): ${loc.filePath}:${loc.line}:${loc.character}\n${loc.lineText ?? ""}`
                : "No definition found (and no external LSP for this language).",
            }],
            details: refs,
          };
        }
        const locs = await client.definition(path, line, character);
        if (!locs.length) return { content: [{ type: "text", text: "No definition found." }] };
        const text = locs.map((l, i) => {
          const p = uriToPath(l.uri);
          return `${i + 1}. ${p}:${l.range.start.line + 1}:${l.range.start.character + 1}`;
        }).join("\n");
        return { content: [{ type: "text", text }], details: { locations: locs } };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const refs: ToolDefinitionLike = {
    name: "lsp_references",
    label: "lsp_references",
    description:
      "Find references. Uses external LSP when available for the file type; falls back to built-in TypeScript language service for TS/JS.",
    promptSnippet: "Find all references to a symbol",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
      line: Type.Number({ description: "1-based line" }),
      character: Type.Number({ description: "1-based column" }),
    }),
    async execute(_id, args) {
      try {
        const path = String(args.path ?? "");
        const line = num(args.line, "line");
        const character = num(args.character, "character");
        const client = await getLspClientForFile(cwd, path);
        if (client) {
          const locs = await client.references(path, line, character);
          const mapped = locs.map((l) => ({
            filePath: uriToPath(l.uri),
            line: l.range.start.line + 1,
            character: l.range.start.character + 1,
          }));
          const text = [
            `References via external LSP (${mapped.length}):`,
            ...mapped.map((m, i) => `${i + 1}. ${m.filePath}:${m.line}:${m.character}`),
          ].join("\n");
          return { content: [{ type: "text", text }], details: { locations: mapped } };
        }
        const result = findReferences(cwd, path, line, character);
        const text = [
          result.symbolName ? `Symbol: ${result.symbolName}` : "Symbol: (unknown)",
          result.configFile ? `Project: ${result.configFile}` : "Project: (inferred)",
          `References (${result.locations.length}):`,
          formatLocations(cwd, result.locations),
        ].join("\n");
        return { content: [{ type: "text", text }], details: result };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const rename: ToolDefinitionLike = {
    name: "lsp_rename",
    label: "lsp_rename",
    description:
      "Rename a TypeScript/JavaScript symbol across the project. Dry-run by default; set apply=true to write files.",
    promptSnippet: "Rename a TS/JS symbol project-wide",
    promptGuidelines: [
      "Prefer lsp_rename with apply=false first to preview edit count, then apply=true.",
    ],
    parameters: Type.Object({
      path: Type.String(),
      line: Type.Number(),
      character: Type.Number(),
      newName: Type.String(),
      apply: Type.Optional(Type.Boolean({ description: "Write files (default false)" })),
    }),
    async execute(_id, args) {
      try {
        const path = String(args.path ?? "");
        const line = num(args.line, "line");
        const character = num(args.character, "character");
        const newName = String(args.newName ?? "");
        const client = await getLspClientForFile(cwd, path);
        if (client) {
          const edits = await client.rename(path, line, character, newName);
          if (args.apply === true) {
            // apply workspace edits simply for textDocument edits
            const byFile = new Map<string, Array<{ start: number; end: number; text: string }>>();
            for (const e of edits) {
              const fp = uriToPath(e.uri);
              const content = readFileSync(fp, "utf8");
              // approximate offsets via line/col split
              const lines = content.split(/\n/);
              const toOff = (l: number, c: number) => {
                let off = 0;
                for (let i = 0; i < l && i < lines.length; i++) off += (lines[i]?.length ?? 0) + 1;
                return off + c;
              };
              const start = toOff(e.range.start.line, e.range.start.character);
              const end = toOff(e.range.end.line, e.range.end.character);
              const list = byFile.get(fp) ?? [];
              list.push({ start, end, text: e.newText });
              byFile.set(fp, list);
            }
            const filesChanged: string[] = [];
            for (const [fp, list] of byFile) {
              let text = readFileSync(fp, "utf8");
              list.sort((a, b) => b.start - a.start);
              for (const e of list) text = text.slice(0, e.start) + e.text + text.slice(e.end);
              writeFileSync(fp, text, "utf8");
              filesChanged.push(fp);
            }
            return {
              content: [{
                type: "text",
                text: `External LSP rename applied: ${edits.length} edit(s) in ${filesChanged.length} file(s)\n${filesChanged.map((f) => `- ${f}`).join("\n")}`,
              }],
              details: { edits, filesChanged },
            };
          }
          return {
            content: [{
              type: "text",
              text: `External LSP dry-run rename → '${newName}': ${edits.length} edit(s)\nRe-run with apply=true to write.`,
            }],
            details: { edits },
          };
        }

        const plan = planRename(cwd, path, line, character, newName);
        if (args.apply === true) {
          const applied = applyRenameEdits(plan.edits);
          return {
            content: [{
              type: "text",
              text: `Renamed '${plan.symbolName}' → '${newName}' (${applied.count} edits in ${applied.filesChanged.length} file(s))\n${applied.filesChanged.map((f) => `- ${f}`).join("\n")}`,
            }],
            details: { plan, applied },
          };
        }
        const byFile = new Map<string, number>();
        for (const e of plan.edits) byFile.set(e.filePath, (byFile.get(e.filePath) ?? 0) + 1);
        const summary = [...byFile.entries()].map(([f, n]) => `- ${f}: ${n} edit(s)`).join("\n");
        return {
          content: [{
            type: "text",
            text: `Dry-run rename '${plan.symbolName}' → '${newName}': ${plan.edits.length} edit(s)\n${summary}\n\nRe-run with apply=true to write.`,
          }],
          details: plan,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const hashline: ToolDefinitionLike = {
    name: "hashline_edit",
    label: "hashline_edit",
    description:
      "Edit a file using hash-anchored exact replacements. Optional hash = sha1(oldText).slice(0,12) rejects stale anchors. Prefer when edit fails due to drift.",
    promptSnippet: "Hash-anchored exact text replacement",
    parameters: Type.Object({
      path: Type.String(),
      hunks: Type.Array(Type.Object({
        hash: Type.Optional(Type.String()),
        oldText: Type.String(),
        newText: Type.String(),
      })),
    }),
    async execute(_id, args) {
      try {
        const hunks = Array.isArray(args.hunks) ? args.hunks as Array<{ hash?: string; oldText: string; newText: string }> : [];
        // Auto-fill hashes for model convenience when omitted
        const normalized = hunks.map((h) => ({
          ...h,
          hash: h.hash || hashBlock(h.oldText),
        }));
        const result = applyHashlineEdits(cwd, String(args.path ?? ""), normalized);
        return {
          content: [{
            type: "text",
            text: `Applied ${result.applied} hashline hunk(s) to ${result.path}\nhashes: ${result.hashes.join(", ")}`,
          }],
          details: result,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  const ast: ToolDefinitionLike = {
    name: "ast_edit",
    label: "ast_edit",
    description:
      "AST-aware edit for TS/JS: rename_identifier (in-file) or replace_text_in_node at a position.",
    promptSnippet: "AST-based structural edit for TypeScript/JavaScript",
    parameters: Type.Object({
      path: Type.String(),
      kind: Type.String({ description: "rename_identifier | replace_text_in_node" }),
      line: Type.Number(),
      character: Type.Number(),
      newName: Type.Optional(Type.String()),
      newText: Type.Optional(Type.String()),
    }),
    async execute(_id, args) {
      try {
        const kind = String(args.kind ?? "");
        if (kind === "rename_identifier") {
          const result = applyAstEdit(cwd, String(args.path ?? ""), {
            kind: "rename_identifier",
            line: num(args.line, "line"),
            character: num(args.character, "character"),
            newName: String(args.newName ?? ""),
          });
          return { content: [{ type: "text", text: result.description }], details: result };
        }
        if (kind === "replace_text_in_node") {
          const result = applyAstEdit(cwd, String(args.path ?? ""), {
            kind: "replace_text_in_node",
            line: num(args.line, "line"),
            character: num(args.character, "character"),
            newText: String(args.newText ?? ""),
          });
          return { content: [{ type: "text", text: result.description }], details: result };
        }
        throw new Error("kind must be rename_identifier or replace_text_in_node");
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };

  return [servers, hover, definition, refs, rename, hashline, ast];
}
