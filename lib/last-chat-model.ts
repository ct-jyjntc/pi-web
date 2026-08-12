/**
 * Last composer model + thinking. New sessions follow this snapshot;
 * Settings defaultModel / defaultThinkingLevel stay the Reset fallback.
 */
import { isRecord } from "./type-guards";
import type { ThinkingLevelOption } from "./agent-session-live-apply";

export type LastChatModel = {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevelOption;
};

export type SelectedChatModel = { provider: string; modelId: string };

export type NewSessionSeed = {
  model: SelectedChatModel | null;
  thinkingLevel: ThinkingLevelOption | null;
  fromLast: boolean;
};

export type ReconcileNewSessionLastChatResult = {
  model: SelectedChatModel | null;
  thinkingLevel: ThinkingLevelOption;
  applyConfiguredThinking: boolean;
};

const THINKING_LEVELS = new Set<ThinkingLevelOption>([
  "auto", "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

function asThinkingLevel(value: unknown): ThinkingLevelOption {
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevelOption)) {
    return value as ThinkingLevelOption;
  }
  return "auto";
}

export function parseLastChatModel(value: unknown): LastChatModel | null {
  if (!isRecord(value)) return null;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string"
    ? value.modelId.trim()
    : typeof value.id === "string"
      ? value.id.trim()
      : "";
  if (!provider || !modelId) return null;
  return { provider, modelId, thinkingLevel: asThinkingLevel(value.thinkingLevel) };
}

export function lastChatModelsEqual(a: LastChatModel | null, b: LastChatModel | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.provider === b.provider && a.modelId === b.modelId && a.thinkingLevel === b.thinkingLevel;
}

function catalogHas(
  catalog: ReadonlyArray<{ provider: string; id: string }>,
  provider: string,
  modelId: string,
): boolean {
  return catalog.some((entry) => entry.provider === provider && entry.id === modelId);
}

export function pickNewSessionSeed(args: {
  last: LastChatModel | null;
  catalog: ReadonlyArray<{ provider: string; id: string }>;
  catalogReady: boolean;
}): NewSessionSeed {
  if (!args.last) return { model: null, thinkingLevel: null, fromLast: false };
  if (args.catalogReady && !catalogHas(args.catalog, args.last.provider, args.last.modelId)) {
    return { model: null, thinkingLevel: null, fromLast: false };
  }
  return {
    model: { provider: args.last.provider, modelId: args.last.modelId },
    thinkingLevel: args.last.thinkingLevel,
    fromLast: true,
  };
}

export function initialNewSessionSeed(
  isNew: boolean,
  settingsLast: unknown,
  catalog: ReadonlyArray<{ provider: string; id: string }> | null | undefined,
): NewSessionSeed {
  if (!isNew) return { model: null, thinkingLevel: null, fromLast: false };
  return pickNewSessionSeed({
    last: parseLastChatModel(settingsLast),
    catalog: catalog ?? [],
    catalogReady: (catalog?.length ?? 0) > 0,
  });
}

/** After the catalog loads: keep a still-visible pick, else last, else configured default. */
export function reconcileNewSessionLastChat(args: {
  current: SelectedChatModel | null;
  last: LastChatModel | null;
  catalog: ReadonlyArray<{ provider: string; id: string }>;
  currentThinking: ThinkingLevelOption;
}): ReconcileNewSessionLastChatResult {
  const seed = pickNewSessionSeed({ last: args.last, catalog: args.catalog, catalogReady: true });
  const current = args.current;
  if (current && catalogHas(args.catalog, current.provider, current.modelId)) {
    return {
      model: current,
      thinkingLevel: args.currentThinking,
      applyConfiguredThinking: false,
    };
  }
  if (seed.fromLast && seed.model) {
    return {
      model: seed.model,
      thinkingLevel: seed.thinkingLevel ?? "auto",
      applyConfiguredThinking: false,
    };
  }
  const thinkingLevel = current ? "auto" : args.currentThinking;
  return {
    model: null,
    thinkingLevel,
    applyConfiguredThinking: thinkingLevel === "auto",
  };
}

/** Persist a composer pick. No-op when unchanged. Failure leaves the last good snapshot. */
export function rememberLastChatModel(
  next: SelectedChatModel & { thinkingLevel: ThinkingLevelOption },
): void {
  const normalized: LastChatModel = {
    provider: next.provider.trim(),
    modelId: next.modelId.trim(),
    thinkingLevel: asThinkingLevel(next.thinkingLevel),
  };
  if (!normalized.provider || !normalized.modelId) return;
  // Dynamic import keeps this module testable without the client settings store.
  void import("./web-settings-store").then(({ getWebSettings, saveWebSettings }) => {
    const current = parseLastChatModel(getWebSettings()?.lastChatModel);
    if (lastChatModelsEqual(current, normalized)) return;
    return saveWebSettings(
      { lastChatModel: normalized },
      { optimistic: { lastChatModel: normalized } },
    );
  }).catch((error) => {
    console.error("[pi-web] rememberLastChatModel failed:", error);
  });
}
