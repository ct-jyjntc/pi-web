import { NextRequest, NextResponse } from "next/server";
import {
  formatModelRef,
  parseModelRef,
  readWebSettings,
  writeWebSettings,
  type CodeThemeId,
  type ThemeMode,
  type ThinkingLevelPref,
  type ModelRef,
  type WebSettings,
} from "@/lib/web-settings";
import { formatModelRoles, parseModelRoles, type ModelRole } from "@/lib/model-roles";
import { syncAgentModelsFromRoles } from "@/lib/ensure-subagent-delegation";
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
    modelRolesRefs: formatModelRoles(settings.modelRoles),
  };
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value === "string") return value;
  return undefined;
}
function preserveThinkingPreference(next: ModelRef | null, current: ModelRef | null): ModelRef | null {
  if (!next || next.thinkingLevel !== undefined || !current?.thinkingLevel) return next;
  return { ...next, thinkingLevel: current.thinkingLevel };
}

function asOptionalBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * `?utilityModels=0` skips the model catalog for callers that only need the
 * settings object (the transcript polls this endpoint for booleans). Default
 * stays "include" so existing callers are unaffected.
 */
function wantsUtilityModels(raw: string | null): boolean {
  if (raw === null) return true;
  const value = raw.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
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
    if (wantsUtilityModels(req.nextUrl.searchParams.get("utilityModels"))) {
      try {
        models = await listUtilityModels(cwd);
      } catch {
        models = [];
      }
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
      const parsed = body.titleModel === "" || body.titleModel == null ? null : parseModelRef(body.titleModel);
      patch.titleModel = preserveThinkingPreference(parsed, readWebSettings().titleModel);
      if (body.titleModel && body.titleModel !== "" && !patch.titleModel) {
        return NextResponse.json({ error: "Invalid titleModel" }, { status: 400 });
      }
    }
    if ("commitModel" in body) {
      const parsed = body.commitModel === "" || body.commitModel == null ? null : parseModelRef(body.commitModel);
      patch.commitModel = preserveThinkingPreference(parsed, readWebSettings().commitModel);
      if (body.commitModel && body.commitModel !== "" && !patch.commitModel) {
        return NextResponse.json({ error: "Invalid commitModel" }, { status: 400 });
      }
    }

    if ("modelRoles" in body) {
      const nextRoles = parseModelRoles(body.modelRoles);
      // Allow partial updates: { modelRoles: { smol: "provider/id" } }
      if (body.modelRoles && typeof body.modelRoles === "object" && !Array.isArray(body.modelRoles)) {
        const current = readWebSettings().modelRoles;
        const partial = body.modelRoles as Record<string, unknown>;
        const roles = { ...current };
        for (const role of ["default", "smol", "plan"] as ModelRole[]) {
          if (!(role in partial)) continue;
          const raw = partial[role];
          if (raw === "" || raw == null) {
            roles[role] = null;
            continue;
          }
          const parsed = parseModelRef(raw);
          if (!parsed) {
            return NextResponse.json({ error: `Invalid modelRoles.${role}` }, { status: 400 });
          }
          roles[role] = preserveThinkingPreference(parsed, current[role]);
        }
        patch.modelRoles = roles;
      } else if (body.modelRoles == null) {
        patch.modelRoles = nextRoles;
      } else {
        return NextResponse.json({ error: "Invalid modelRoles" }, { status: 400 });
      }
    }

    // Convenience: set a single role via modelRole + modelRoleRef
    if ("modelRole" in body && "modelRoleRef" in body) {
      const role = body.modelRole;
      if (role !== "default" && role !== "smol" && role !== "plan") {
        return NextResponse.json({ error: "Invalid modelRole" }, { status: 400 });
      }
      const raw = body.modelRoleRef;
      const parsed = raw === "" || raw == null ? null : parseModelRef(raw);
      if (raw && raw !== "" && !parsed) {
        return NextResponse.json({ error: `Invalid model for role ${role}` }, { status: 400 });
      }
      const current = readWebSettings().modelRoles;
      patch.modelRoles = { ...current, [role]: preserveThinkingPreference(parsed, current[role]) };
    }
    if ("modelRoleThinking" in body) {
      const role = body.modelRole;
      if (role !== "default" && role !== "smol" && role !== "plan") {
        return NextResponse.json({ error: "Invalid modelRole" }, { status: 400 });
      }
      const value = body.modelRoleThinking;
      if (typeof value !== "string" || !THINKING.includes(value as ThinkingLevelPref)) {
        return NextResponse.json({ error: "Invalid modelRoleThinking" }, { status: 400 });
      }
      const current = readWebSettings().modelRoles;
      const currentRole = current[role];
      if (!currentRole) {
        return NextResponse.json({ error: `No model configured for role ${role}` }, { status: 400 });
      }
      patch.modelRoles = { ...current, [role]: { ...currentRole, thinkingLevel: value as ThinkingLevelPref } };
    }
    if ("modelPrefThinking" in body) {
      const key = body.modelPref;
      if (key !== "titleModel" && key !== "commitModel" && key !== "advisorModel") {
        return NextResponse.json({ error: "Invalid modelPref" }, { status: 400 });
      }
      const value = body.modelPrefThinking;
      if (typeof value !== "string" || !THINKING.includes(value as ThinkingLevelPref)) {
        return NextResponse.json({ error: "Invalid modelPrefThinking" }, { status: 400 });
      }
      const current = readWebSettings()[key];
      if (!current) {
        return NextResponse.json({ error: `No model configured for ${key}` }, { status: 400 });
      }
      patch[key] = { ...current, thinkingLevel: value as ThinkingLevelPref };
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

    if ("advisorEnabled" in body) {
      const v = asOptionalBool(body.advisorEnabled);
      if (v === undefined) return NextResponse.json({ error: "Invalid advisorEnabled" }, { status: 400 });
      patch.advisorEnabled = v;
    }
    if ("advisorModel" in body) {
      const parsed = body.advisorModel === "" || body.advisorModel == null ? null : parseModelRef(body.advisorModel);
      patch.advisorModel = preserveThinkingPreference(parsed, readWebSettings().advisorModel);
      if (body.advisorModel && body.advisorModel !== "" && !patch.advisorModel) {
        return NextResponse.json({ error: "Invalid advisorModel" }, { status: 400 });
      }
    }

    if ("projectMemory" in body) {
      if (!body.projectMemory || typeof body.projectMemory !== "object" || Array.isArray(body.projectMemory)) {
        return NextResponse.json({ error: "Invalid projectMemory" }, { status: 400 });
      }
      const current = readWebSettings().projectMemory;
      const raw = body.projectMemory as Record<string, unknown>;
      const next = { ...current };
      if ("enabled" in raw) {
        if (typeof raw.enabled !== "boolean") {
          return NextResponse.json({ error: "Invalid projectMemory.enabled" }, { status: 400 });
        }
        next.enabled = raw.enabled;
      }
      if ("autoInject" in raw) {
        if (typeof raw.autoInject !== "boolean") {
          return NextResponse.json({ error: "Invalid projectMemory.autoInject" }, { status: 400 });
        }
        next.autoInject = raw.autoInject;
      }
      if ("autoInjectTopK" in raw) {
        const n = Number(raw.autoInjectTopK);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: "Invalid projectMemory.autoInjectTopK" }, { status: 400 });
        }
        next.autoInjectTopK = n;
      }
      patch.projectMemory = next;
    }

    if ("leanMode" in body) {
      if (!body.leanMode || typeof body.leanMode !== "object" || Array.isArray(body.leanMode)) {
        return NextResponse.json({ error: "Invalid leanMode" }, { status: 400 });
      }
      const current = readWebSettings().leanMode;
      const raw = body.leanMode as Record<string, unknown>;
      const next = { ...current };
      if ("enabled" in raw) {
        if (typeof raw.enabled !== "boolean") {
          return NextResponse.json({ error: "Invalid leanMode.enabled" }, { status: 400 });
        }
        next.enabled = raw.enabled;
      }
      if ("intensity" in raw) {
        if (raw.intensity !== "soft" && raw.intensity !== "review" && raw.intensity !== "hard") {
          return NextResponse.json({ error: "Invalid leanMode.intensity" }, { status: 400 });
        }
        next.intensity = raw.intensity;
      }
      patch.leanMode = next;
    }

    const settings = writeWebSettings(patch);
    let idleSessionsReset = 0;
    if (patch.leanMode) {
      try {
        const { destroyIdleRpcSessions } = await import("@/lib/rpc-manager");
        idleSessionsReset = await destroyIdleRpcSessions();
      } catch (error) {
        console.error("[pi-web] destroyIdleRpcSessions failed:", error);
      }
    }
    if (patch.modelRoles) {
      try {
        for (const note of syncAgentModelsFromRoles(settings)) {
          console.log(`[pi-web] ${note}`);
        }
      } catch (error) {
        console.error("[pi-web] syncAgentModelsFromRoles failed:", error);
      }
    }
    return NextResponse.json({
      ok: true,
      settings: settingsPayload(settings),
      idleSessionsReset,
      leanSessionsNote: patch.leanMode
        ? "Lean Mode changes apply on the next agent turn (idle sessions were reset; active runs keep the old prompt until they finish)."
        : undefined,
      requiresRestart: ["httpProxy", "proxyBypass", "customCaCerts", "disableHardwareAcceleration"],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
