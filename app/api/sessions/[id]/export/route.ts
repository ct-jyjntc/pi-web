import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { existsSync, mkdirSync, promises as fsp, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { promisify } from "util";
import { fileURLToPath, pathToFileURL } from "url";
import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

type PiCodingAgentModule = {
  getPackageDir: () => string;
};

type ExportHtmlModule = {
  exportFromFile: (inputPath: string, outputPath: string) => Promise<string>;
};

async function getPiPackageDir(): Promise<string | null> {
  try {
    const { getPackageDir } = (await import("@earendil-works/pi-coding-agent")) as PiCodingAgentModule;
    return getPackageDir();
  } catch {
    return null;
  }
}

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function getContentDisposition(fileName: string, inline: boolean): string {
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "session.html";
  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}

async function getPiCliPath(): Promise<string | null> {
  const candidates = new Set<string>();
  const packageDir = await getPiPackageDir();

  if (packageDir) {
    candidates.add(join(packageDir, "dist", "cli.js"));
  }

  try {
    const resolver = (import.meta as ImportMeta & {
      resolve?: (specifier: string) => string | Promise<string>;
    }).resolve;
    if (typeof resolver === "function") {
      const indexUrl = await resolver("@earendil-works/pi-coding-agent");
      candidates.add(join(dirname(fileURLToPath(indexUrl)), "cli.js"));
    }
  } catch {
    // Next.js production bundles can strip import.meta.resolve.
  }

  candidates.add(
    join(
      process.cwd(),
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "cli.js"
    )
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Patches applied by patchExportHtml() to the exported HTML, replacing recursive
 * functions that overflow the call stack on deep linear session trees
 * (e.g., 5000+ entries).
 *
 * ## Root Cause
 * pi-coding-agent's template.js uses recursive helpers to render and
 * navigate the session tree in the exported HTML:
 *
 *   1. sortChildren(node) — recursively sorts children of every node.
 *      Calls itself via node.children.forEach(sortChildren).
 *      On a 5527-entry linear chain (no branches), this recurses 5527
 *      levels deep → stack overflow.
 *
 *   2. mapNodes(node) — recursively indexes tree nodes the first time
 *      a tree item is clicked. Same depth -> same overflow.
 *
 *   3. markActive(node) — recursively marks nodes on the active path.
 *      Calls itself via markActive(child) for each child.
 *      Same depth → same overflow.
 *
 * Both functions are inlined in the HTML by pi-coding-agent at export
 * time. We cannot modify template.js directly (it's in node_modules
 * and would be overwritten on npm install). Instead, we patch the
 * generated HTML string before returning it to the client.
 *
 * ## Fix
 * Replace each recursive function with an iterative equivalent:
 *
 *   sortChildren  → explicit stack (DFS pre-order, push children in
 *                   reverse to maintain order)
 *   mapNodes      → explicit stack (DFS pre-order)
 *   markActive    → two-stack post-order (stack1 for traversal,
 *                   stack2 for processing children before parent)
 *
 * ## Line Ending Normalization
 * This file (route.ts) may be checked out with CRLF (Windows), while
 * template.js uses LF (Unix). The template strings in the backtick
 * literals inherit the file's line endings, so a patch written here can
 * differ from the exported HTML by \r\n vs \n alone.
 *
 * The exported HTML inlines the whole session JSON and can reach tens of
 * MB, so it is never copied to normalize line endings. Each patch is
 * looked up with LF needles first and CRLF needles only on a miss, then
 * all patches are spliced into the document in a single pass.
 */
type ExportHtmlPatch = { name: string; search: string; replacement: string };
type LocatedExportHtmlPatch = { index: number; length: number; replacement: string };

const EXPORT_HTML_PATCHES: ExportHtmlPatch[] = [
  {
    name: "sortChildren",
    search: `        function sortChildren(node) {
          node.children.sort((a, b) =>
            new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
          );
          node.children.forEach(sortChildren);
        }`,
    replacement: `        function sortChildren(root) {
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            node.children.sort((a, b) =>
              new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
            );
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }
        }`,
  },
  {
    name: "mapNodes",
    search: `          function mapNodes(node) {
            treeNodeMap.set(node.entry.id, node);
            node.children.forEach(mapNodes);
          }
          tree.forEach(mapNodes);`,
    replacement: `          const stack = [...tree].reverse();
          while (stack.length) {
            const node = stack.pop();
            treeNodeMap.set(node.entry.id, node);
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }`,
  },
  {
    name: "markActive",
    search: `        function markActive(node) {
          let has = activePathIds.has(node.entry.id);
          for (const child of node.children) {
            if (markActive(child)) has = true;
          }
          containsActive.set(node, has);
          return has;
        }`,
    replacement: `        function markActive(root) {
          // Post-order traversal using two stacks
          const stack1 = [root];
          const stack2 = [];
          while (stack1.length) {
            const node = stack1.pop();
            stack2.push(node);
            for (const child of node.children) {
              stack1.push(child);
            }
          }
          while (stack2.length) {
            const node = stack2.pop();
            let has = activePathIds.has(node.entry.id);
            for (const child of node.children) {
              if (containsActive.get(child)) has = true;
            }
            containsActive.set(node, has);
          }
        }`,
  },
];

const toLf = (value: string): string => value.replace(/\r\n/g, "\n");
const toCrlf = (value: string): string => toLf(value).replace(/\n/g, "\r\n");

/** First offset and total occurrence count of `search`, without allocating.
 *  `split(search).length - 1` would build an array of substrings spanning the
 *  entire multi-MB export just to count matches. */
function findOccurrences(source: string, search: string): { first: number; count: number } {
  let first = -1;
  let count = 0;
  for (let index = source.indexOf(search); index !== -1; index = source.indexOf(search, index + search.length)) {
    if (count === 0) first = index;
    count += 1;
  }
  return { first, count };
}

/** Resolve one patch to a single document offset. Throws unless the needle hits
 *  exactly once — a silently unpatched export still overflows the browser stack,
 *  so a missed patch must fail loudly instead. */
function locateExportHtmlPatch(html: string, patch: ExportHtmlPatch): LocatedExportHtmlPatch {
  const lfSearch = toLf(patch.search);
  const lf = findOccurrences(html, lfSearch);
  if (lf.count === 1) {
    return { index: lf.first, length: lfSearch.length, replacement: toLf(patch.replacement) };
  }

  // Fall back to CRLF needles: a multi-line LF needle can never match inside a
  // CRLF document, so the counts sum to the number of logical matches.
  const crlfSearch = toCrlf(patch.search);
  const crlf = crlfSearch === lfSearch ? { first: -1, count: 0 } : findOccurrences(html, crlfSearch);
  if (lf.count === 0 && crlf.count === 1) {
    return { index: crlf.first, length: crlfSearch.length, replacement: toCrlf(patch.replacement) };
  }

  throw new Error(
    `Failed to patch exported HTML: ${patch.name} expected 1 match, found ${lf.count + crlf.count}`
  );
}

function patchExportHtml(html: string): string {
  const located = EXPORT_HTML_PATCHES.map((patch) => locateExportHtmlPatch(html, patch));
  located.sort((a, b) => a.index - b.index);

  // Splice every patch in one pass: three sequential replace() calls would each
  // materialize another full copy of the document.
  const parts: string[] = [];
  let cursor = 0;
  for (const patch of located) {
    if (patch.index < cursor) {
      throw new Error("Failed to patch exported HTML: overlapping patch ranges");
    }
    parts.push(html.slice(cursor, patch.index), patch.replacement);
    cursor = patch.index + patch.length;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

async function exportSession(filePath: string, outputPath: string): Promise<void> {
  const cliPath = await getPiCliPath();
  if (cliPath) {
    await execFileAsync(process.execPath, [cliPath, "--export", filePath, outputPath], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
      },
      maxBuffer: 1024 * 1024,
    });
    return;
  }

  const packageDir = await getPiPackageDir();
  if (!packageDir) throw new Error("pi CLI not found");

  const exporterUrl = pathToFileURL(join(packageDir, "dist", "core", "export-html", "index.js")).href;
  const { exportFromFile } = (await import(exporterUrl)) as ExportHtmlModule;
  await exportFromFile(filePath, outputPath);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const tempDir = join(tmpdir(), "pi-web-export");
    mkdirSync(tempDir, { recursive: true });

    const sessionBase = basename(filePath, ".jsonl");
    const fileName = `pi-session-${sessionBase}.html`;
    const outputPath = join(tempDir, `${randomUUID()}.html`);

    try {
      await exportSession(filePath, outputPath);

      const html = await fsp.readFile(outputPath, "utf8");
      const patchedHtml = patchExportHtml(html);
      return new Response(patchedHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": getContentDisposition(fileName, inline),
          "Cache-Control": "no-cache",
        },
      });
    } finally {
      rmSync(outputPath, { force: true });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
