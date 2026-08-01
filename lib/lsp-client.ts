/**
 * Minimal stdio JSON-RPC LSP client for optional language servers.
 * Used when a server binary is available (pyright, gopls, rust-analyzer, …).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { readFileSync } from "fs";
import { extname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getAvailableLspSpecs, whichCommand } from "./lsp-health";

export type LspPosition = { line: number; character: number }; // 0-based for protocol
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspLocation = { uri: string; range: LspRange };

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

export type LspServerSpec = {
  id: string;
  command: string;
  args: string[];
  languages: string[]; // extensions without dot: ts, py, go, rs
  /** Absolute binary path when known */
  resolvedPath?: string;
};

export function discoverLspServers(cwd?: string | null): LspServerSpec[] {
  return getAvailableLspSpecs(cwd).map((s) => ({
    id: s.id,
    command: s.command,
    args: s.args,
    languages: s.languages,
    resolvedPath: s.resolvedPath,
  }));
}

export function languageIdForPath(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    mts: "typescript",
    cts: "typescript",
    py: "python",
    pyi: "python",
    go: "go",
    rs: "rust",
    json: "json",
    md: "markdown",
  };
  return map[ext] ?? "plaintext";
}

export class LspClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private rootUri: string;
  private opened = new Set<string>();

  constructor(
    private readonly spec: LspServerSpec,
    private readonly cwd: string,
  ) {
    this.rootUri = pathToFileURL(resolve(cwd) + "/").href;
  }

  async start(): Promise<void> {
    if (this.proc) return;
    const bin = this.spec.resolvedPath || whichCommand(this.spec.command);
    if (!bin) throw new Error(`LSP server not found: ${this.spec.command}`);
    this.proc = spawn(bin, this.spec.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", () => {
      // ignore noisy logs
    });
    this.proc.on("exit", () => {
      this.proc = null;
      this.initialized = false;
      for (const [, p] of this.pending) p.reject(new Error("LSP server exited"));
      this.pending.clear();
    });

    await this.request("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      rootPath: this.cwd,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didChange: true },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          rename: { prepareSupport: false },
        },
      },
      workspaceFolders: [{ uri: this.rootUri, name: "workspace" }],
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      // ignore
    }
    this.proc.kill();
    this.proc = null;
    this.initialized = false;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buf.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buf = this.buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) return;
      const body = this.buf.slice(bodyStart, bodyStart + len);
      this.buf = this.buf.slice(bodyStart + len);
      try {
        const msg = JSON.parse(body) as { id?: number; result?: unknown; error?: { message?: string } };
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || "LSP error"));
          else p.resolve(msg.result);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.proc?.stdin.writable) throw new Error("LSP server not running");
    const json = JSON.stringify(msg);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async ensureOpen(filePath: string): Promise<string> {
    await this.start();
    const abs = resolve(filePath);
    const uri = pathToFileURL(abs).href;
    if (this.opened.has(uri)) return uri;
    const text = readFileSync(abs, "utf8");
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: languageIdForPath(abs),
        version: 1,
        text,
      },
    });
    this.opened.add(uri);
    // give server a beat to analyze
    await new Promise((r) => setTimeout(r, 150));
    return uri;
  }

  async definition(filePath: string, line: number, character: number): Promise<LspLocation[]> {
    const uri = await this.ensureOpen(filePath);
    const result = await this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    });
    return normalizeLocations(result);
  }

  async references(filePath: string, line: number, character: number): Promise<LspLocation[]> {
    const uri = await this.ensureOpen(filePath);
    const result = await this.request("textDocument/references", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
      context: { includeDeclaration: true },
    });
    return normalizeLocations(result);
  }

  async hover(filePath: string, line: number, character: number): Promise<string> {
    const uri = await this.ensureOpen(filePath);
    const result = await this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    }) as { contents?: unknown } | null;
    if (!result?.contents) return "(no hover)";
    return formatHover(result.contents);
  }

  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<Array<{ uri: string; range: LspRange; newText: string }>> {
    const uri = await this.ensureOpen(filePath);
    const result = await this.request("textDocument/rename", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
      newName,
    }) as { changes?: Record<string, Array<{ range: LspRange; newText: string }>> } | null;
    const edits: Array<{ uri: string; range: LspRange; newText: string }> = [];
    for (const [u, arr] of Object.entries(result?.changes ?? {})) {
      for (const e of arr) edits.push({ uri: u, range: e.range, newText: e.newText });
    }
    return edits;
  }
}

function normalizeLocations(result: unknown): LspLocation[] {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  const out: LspLocation[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { uri?: string; targetUri?: string; range?: LspRange; targetRange?: LspRange; targetSelectionRange?: LspRange };
    const uri = rec.uri || rec.targetUri;
    const range = rec.range || rec.targetSelectionRange || rec.targetRange;
    if (uri && range) out.push({ uri, range });
  }
  return out;
}

function formatHover(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(formatHover).join("\n");
  if (contents && typeof contents === "object") {
    const c = contents as { kind?: string; value?: string; language?: string };
    if (c.value) return c.language ? `\`\`\`${c.language}\n${c.value}\n\`\`\`` : c.value;
  }
  return String(contents);
}

/** Session-scoped client pool (per cwd + server id). */
const pools = new Map<string, LspClient>();

export async function getLspClientForFile(cwd: string, filePath: string): Promise<LspClient | null> {
  const ext = extname(filePath).slice(1).toLowerCase();
  const servers = discoverLspServers(cwd);
  // Prefer primary servers; for Python prefer pyright over pylsp when both exist
  const matches = servers.filter((s) => s.languages.includes(ext));
  const spec =
    matches.find((s) => s.id === "pyright") ??
    matches.find((s) => s.id === "typescript") ??
    matches[0];
  if (!spec) return null;
  const key = `${resolve(cwd)}::${spec.id}`;
  let client = pools.get(key);
  if (!client) {
    client = new LspClient(spec, cwd);
    pools.set(key, client);
  }
  try {
    await client.start();
    return client;
  } catch (error) {
    pools.delete(key);
    throw error;
  }
}

export function listAvailableLspServers(cwd?: string | null): string[] {
  return discoverLspServers(cwd).map(
    (s) => `${s.id} (${s.command}) [${s.languages.join(",")}]${s.resolvedPath ? ` @ ${s.resolvedPath}` : ""}`,
  );
}

export function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return uri;
    }
  }
}
