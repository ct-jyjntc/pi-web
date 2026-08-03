import { NextResponse } from "next/server";
import { type AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { readWebSettings } from "@/lib/web-settings";
import { resolvePreferredSessionModel, resolveUtilityModel } from "@/lib/utility-model";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Header-only read; a full SessionManager.open() parse costs ~60ms of blocked
    // event loop on large archives and nothing else here needs the entries.
    const cwd = readSessionHeader(filePath)?.cwd ?? process.cwd();
    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, cwd);

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    await session.waitUntilReady?.();

    const inner = session.inner as unknown as AgentSession;
    const prefs = readWebSettings();

    let modelOverride = null as Awaited<ReturnType<typeof resolvePreferredSessionModel>>;
    if (prefs.titleModel) {
      try {
        modelOverride = await resolvePreferredSessionModel(
          inner.modelRuntime,
          inner.settingsManager,
          prefs.titleModel,
        );
      } catch {
        // If the live session runtime cannot see the preferred model, resolve via a
        // fresh services load (covers auth/catalog edge cases).
        modelOverride = (await resolveUtilityModel(cwd, prefs.titleModel)).model;
      }
    }

    const result = await generateSessionTitle(inner, {
      ...(modelOverride ? { model: modelOverride } : {}),
      ...(prefs.titleModel?.thinkingLevel ? { thinkingLevel: prefs.titleModel.thinkingLevel } : {}),
    });

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while its title was being generated. Please try again." },
        { status: 409 },
      );
    }

    session.inner.setSessionName(result.title);
    invalidateSessionListCache();
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
