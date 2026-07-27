import { NextRequest, NextResponse } from "next/server";
import {
  formatModelRef,
  parseModelRef,
  readWebSettings,
  writeWebSettings,
  type WebSettings,
} from "@/lib/web-settings";
import { listUtilityModels } from "@/lib/utility-model";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { resolve } from "path";
import { stat } from "fs/promises";

export const dynamic = "force-dynamic";

function pickCwd(raw: string | null | undefined): string {
  const cwd = raw?.trim() || process.cwd();
  if (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd)) {
    return process.cwd();
  }
  return resolve(cwd);
}

export async function GET(req: NextRequest) {
  try {
    const requested = req.nextUrl.searchParams.get("cwd");
    const cwd = pickCwd(requested);
    try {
      const info = await stat(cwd);
      if (!info.isDirectory()) {
        return NextResponse.json({ error: "cwd is not a directory" }, { status: 400 });
      }
    } catch {
      // Fall back to process.cwd() for model listing if the requested path is gone.
    }

    const settings = readWebSettings();
    let models: Awaited<ReturnType<typeof listUtilityModels>> = [];
    try {
      models = await listUtilityModels(cwd);
    } catch {
      models = [];
    }

    return NextResponse.json({
      settings: {
        titleModel: settings.titleModel,
        commitModel: settings.commitModel,
        titleModelRef: formatModelRef(settings.titleModel),
        commitModelRef: formatModelRef(settings.commitModel),
      },
      models,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      titleModel?: unknown;
      commitModel?: unknown;
    };

    const patch: Partial<WebSettings> = {};
    if ("titleModel" in body) {
      // Empty string / null clears the override (use session/default model).
      patch.titleModel = body.titleModel === "" || body.titleModel == null
        ? null
        : parseModelRef(body.titleModel);
      if (body.titleModel && body.titleModel !== "" && !patch.titleModel) {
        return NextResponse.json({ error: "Invalid titleModel" }, { status: 400 });
      }
    }
    if ("commitModel" in body) {
      patch.commitModel = body.commitModel === "" || body.commitModel == null
        ? null
        : parseModelRef(body.commitModel);
      if (body.commitModel && body.commitModel !== "" && !patch.commitModel) {
        return NextResponse.json({ error: "Invalid commitModel" }, { status: 400 });
      }
    }

    const settings = writeWebSettings(patch);
    return NextResponse.json({
      ok: true,
      settings: {
        titleModel: settings.titleModel,
        commitModel: settings.commitModel,
        titleModelRef: formatModelRef(settings.titleModel),
        commitModelRef: formatModelRef(settings.commitModel),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
