import { NextRequest, NextResponse } from "next/server";
import {
  formatModelRef,
  parseModelRef,
  readWebSettings,
  writeWebSettings,
  type CodeThemeId,
  type ThemeMode,
  type ThinkingLevelPref,
  type WebSettings,
} from "@/lib/web-settings";
import { listUtilityModels } from "@/lib/utility-model";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { resolve } from "path";
import { stat } from "fs/promises";

export const dynamic = "force-dynamic";

const THINKING: ThinkingLevelPref[] = [
  "auto", "off", "minimal", "low", "medium", "high", "xhigh", "max",
];
const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const CODE_THEMES: CodeThemeId[] = [
  "vs", "ghcolors", "oneLight", "vscDarkPlus", "oneDark", "materialDark",
];

function pickCwd(raw: string | null | undefined): string {
  const cwd = raw?.trim() || process.cwd();
  if (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd)) {
    return process.cwd();
  }
  return resolve(cwd);
}

function settingsPayload(settings: WebSettings) {
  return {
    ...settings,
    titleModelRef: formatModelRef(settings.titleModel),
    commitModelRef: formatModelRef(settings.commitModel),
  };
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value === "string") return value;
  return undefined;
}

function asOptionalBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
      // Fall back for model listing if path is gone.
    }

    const settings = readWebSettings();
    let models: Awaited<ReturnType<typeof listUtilityModels>> = [];
    try {
      models = await listUtilityModels(cwd);
    } catch {
      models = [];
    }

    return NextResponse.json({
      settings: settingsPayload(settings),
      models,
      requiresRestart: ["httpProxy", "proxyBypass", "customCaCerts", "disableHardwareAcceleration"],
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
    const body = await req.json() as Record<string, unknown>;
    const patch: Partial<WebSettings> = {};

    if ("titleModel" in body) {
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

    const strFields = [
      "httpProxy",
      "proxyBypass",
      "customCaCerts",
      "terminalFont",
    ] as const;
    for (const key of strFields) {
      if (key in body) {
        const v = asOptionalString(body[key]);
        if (v === undefined) {
          return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
        }
        patch[key] = v;
      }
    }

    const boolFields = [
      "soundEnabled",
      "desktopNotifications",
      "notificationSound",
      "showThinking",
      "showTodos",
      "showCodeLineNumbers",
      "wrapCodeLines",
      "inheritTerminalEnv",
      "disableHardwareAcceleration",
      "autoCheckUpdates",
      "autoDownloadUpdates",
    ] as const;
    for (const key of boolFields) {
      if (key in body) {
        const v = asOptionalBool(body[key]);
        if (v === undefined) {
          return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
        }
        patch[key] = v;
      }
    }

    if ("defaultThinkingLevel" in body) {
      const v = body.defaultThinkingLevel;
      if (typeof v !== "string" || !THINKING.includes(v as ThinkingLevelPref)) {
        return NextResponse.json({ error: "Invalid defaultThinkingLevel" }, { status: 400 });
      }
      patch.defaultThinkingLevel = v as ThinkingLevelPref;
    }
    if ("themeMode" in body) {
      const v = body.themeMode;
      if (typeof v !== "string" || !THEME_MODES.includes(v as ThemeMode)) {
        return NextResponse.json({ error: "Invalid themeMode" }, { status: 400 });
      }
      patch.themeMode = v as ThemeMode;
    }
    if ("codeThemeLight" in body) {
      const v = body.codeThemeLight;
      if (typeof v !== "string" || !CODE_THEMES.includes(v as CodeThemeId)) {
        return NextResponse.json({ error: "Invalid codeThemeLight" }, { status: 400 });
      }
      patch.codeThemeLight = v as CodeThemeId;
    }
    if ("codeThemeDark" in body) {
      const v = body.codeThemeDark;
      if (typeof v !== "string" || !CODE_THEMES.includes(v as CodeThemeId)) {
        return NextResponse.json({ error: "Invalid codeThemeDark" }, { status: 400 });
      }
      patch.codeThemeDark = v as CodeThemeId;
    }
    if ("uiFontSize" in body) {
      const n = Number(body.uiFontSize);
      if (!Number.isFinite(n)) return NextResponse.json({ error: "Invalid uiFontSize" }, { status: 400 });
      patch.uiFontSize = n;
    }
    if ("codeFontSize" in body) {
      const n = Number(body.codeFontSize);
      if (!Number.isFinite(n)) return NextResponse.json({ error: "Invalid codeFontSize" }, { status: 400 });
      patch.codeFontSize = n;
    }

    const settings = writeWebSettings(patch);
    return NextResponse.json({
      ok: true,
      settings: settingsPayload(settings),
      requiresRestart: ["httpProxy", "proxyBypass", "customCaCerts", "disableHardwareAcceleration"],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
