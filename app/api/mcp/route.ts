import { NextRequest, NextResponse } from "next/server";
import {
  getAgentMcpPath,
  getMcpAdapterStatus,
  listMcpServers,
  removeAgentMcpServer,
  setMcpServerDisabled,
  upsertAgentMcpServer,
  type McpServerEntry,
} from "@/lib/mcp-config";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { resolve } from "path";
import { stat } from "fs/promises";

export const dynamic = "force-dynamic";

async function resolveCwd(raw: string | null | undefined): Promise<string | null> {
  if (!raw || !raw.trim()) return null;
  const cwd = resolve(raw.trim());
  try {
    if (!(await stat(cwd)).isDirectory()) return null;
  } catch {
    return null;
  }
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots)) {
    throw Object.assign(new Error("Access denied for cwd"), { status: 403 });
  }
  return cwd;
}

export async function GET(req: NextRequest) {
  try {
    const cwd = await resolveCwd(req.nextUrl.searchParams.get("cwd"));
    const servers = listMcpServers(cwd);
    const adapter = getMcpAdapterStatus();
    return NextResponse.json({
      servers,
      adapter,
      agentConfigPath: getAgentMcpPath(),
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string;
      command?: string;
      args?: string[] | string;
      url?: string;
      env?: Record<string, string>;
      headers?: Record<string, string>;
      cwd?: string;
      disabled?: boolean;
    };
    const name = body.name?.trim() ?? "";
    let args: string[] | undefined;
    if (Array.isArray(body.args)) args = body.args.map(String);
    else if (typeof body.args === "string" && body.args.trim()) {
      args = body.args.trim().split(/\s+/);
    }
    const entry: McpServerEntry = {};
    if (body.command?.trim()) entry.command = body.command.trim();
    if (args?.length) entry.args = args;
    if (body.url?.trim()) entry.url = body.url.trim();
    if (body.env && typeof body.env === "object") entry.env = body.env;
    if (body.headers && typeof body.headers === "object") entry.headers = body.headers;
    if (typeof body.cwd === "string") entry.cwd = body.cwd.trim();
    if (body.disabled === true) entry.disabled = true;
    if (entry.url && !entry.command) {
      delete entry.command;
      delete entry.args;
    }
    if (entry.command && !entry.url) delete entry.url;
    const server = upsertAgentMcpServer(name, entry);
    return NextResponse.json({ server });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string;
      disabled?: boolean;
      cwd?: string;
    };
    const name = body.name?.trim() ?? "";
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (typeof body.disabled !== "boolean") {
      return NextResponse.json({ error: "disabled boolean required" }, { status: 400 });
    }
    const cwd = await resolveCwd(body.cwd ?? null);
    const server = setMcpServerDisabled(name, body.disabled, cwd);
    return NextResponse.json({ server });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { name?: string };
    const name = body.name?.trim() ?? "";
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    removeAgentMcpServer(name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
