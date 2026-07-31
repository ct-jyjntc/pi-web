import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { filterDisabledModels, getDisabledModelRefs } from "@/lib/disabled-models";
import { loadModelsWithCache, withModelRuntimeError, type ModelsData } from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { readWebSettings } from "@/lib/web-settings";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

async function loadModels(cwd: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string; supportsImage: boolean }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  const imageSupport: Record<string, boolean> = {};

  const agentDir = getAgentDir();
  const modelRuntime = await createConfiguredModelRuntime();
  const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
  const modelError = services.modelRuntime.getError();
  const settings: SettingsManager = services.settingsManager;

  // `enabledModels` supports globs and fuzzy patterns — same rules as pi's `--models`.
  const scope = await resolveVisibleModels(
    services.modelRuntime,
    settings.getEnabledModels(),
  );

  // models.json `disabled: true` — keep config, hide from pickers (after scope).
  const visible = filterDisabledModels(scope.visible, getDisabledModelRefs());
  // Rebuild pins for models that remain visible after the disabled denylist.
  const thinkingLevelPins: Record<string, string> = {};
  for (const [ref, level] of Object.entries(scope.thinkingLevelPins)) {
    const [provider, ...rest] = ref.split("/");
    const id = rest.join("/");
    if (visible.some((m) => m.provider === provider && m.id === id)) {
      thinkingLevelPins[ref] = level;
    }
  }

  modelList = visible.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    supportsImage: Array.isArray(m.input) && m.input.includes("image"),
  })).sort(compareModelEntries);
  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = getSupportedThinkingLevels(m);
    if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    imageSupport[key] = Array.isArray(m.input) && m.input.includes("image");
  }

  // Prefer Pi Web role default for new sessions; fall back to settings.json default.
  const roleDefault = readWebSettings().modelRoles.default;
  const settingsDefault = (() => {
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    return provider && modelId ? { provider, modelId } : undefined;
  })();

  // Scope-aware default selection (respects globs; falls back sensibly).
  const scopedDefault = selectInitialModelScope(
    { ...scope, visible, thinkingLevelPins },
    {
      ...(roleDefault
        ? { defaultModel: { provider: roleDefault.provider, modelId: roleDefault.modelId } }
        : settingsDefault
          ? { defaultModel: settingsDefault }
          : {}),
    },
  );
  if (scopedDefault.model) {
    defaultModel = { provider: scopedDefault.model.provider, modelId: scopedDefault.model.id };
  } else if (
    roleDefault
    && visible.some((m) => m.provider === roleDefault.provider && m.id === roleDefault.modelId)
  ) {
    defaultModel = { provider: roleDefault.provider, modelId: roleDefault.modelId };
  } else if (
    settingsDefault
    && visible.some((m) => m.provider === settingsDefault.provider && m.id === settingsDefault.modelId)
  ) {
    defaultModel = settingsDefault;
  }

  return withModelRuntimeError(
    {
      models: Object.fromEntries(nameMap),
      modelList,
      defaultModel,
      thinkingLevels,
      thinkingLevelMaps,
      thinkingLevelPins,
      imageSupport,
      ...(scope.warnings.length > 0 ? { modelScopeWarnings: scope.warnings } : {}),
    },
    modelError,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
  imageSupport: {},
};

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  try {
    return Response.json(await loadModelsWithCache(cwd, () => loadModels(cwd)));
  } catch {
    return Response.json(EMPTY_MODELS);
  }
}
