/**
 * Shared client cache for /api/web-settings.
 *
 * Every consumer used to fetch the endpoint on its own — the transcript alone
 * fired one request per rendered thinking block (~40 per long run) just to read
 * a boolean. This module keeps one module-level snapshot, dedupes concurrent
 * loads onto a single in-flight request and throttles re-reads, so the whole
 * app costs at most one request per refresh window.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { WebSettings } from "@/lib/web-settings";
import { apiFetch } from "@/lib/api-transport";

/** Floor between two lightweight reads (matches ChatWindow's own throttle). */
const REFRESH_MIN_MS = 30_000;
/** Short floor after a failed read so a burst of mounts cannot hammer a dead endpoint. */
const ERROR_BACKOFF_MS = 3_000;
/** `utilityModels=0` skips the model catalog (~570ms cold on the server). */
const LIGHT_URL = "/api/web-settings?utilityModels=0";

/**
 * Scalar settings the client reads directly. Object-valued fields (projectMemory,
 * advisorModel, modelRoles…) stay `unknown` so callers keep validating them.
 */
type ScalarSettingKey =
  | "httpProxy"
  | "proxyBypass"
  | "customCaCerts"
  | "soundEnabled"
  | "desktopNotifications"
  | "notificationSound"
  | "defaultThinkingLevel"
  | "agentMode"
  | "showThinking"
   | "showTodos"
   | "expandReviewDiffs"
  | "themeMode"
  | "uiFontSize"
  | "codeThemeLight"
  | "codeThemeDark"
  | "showCodeLineNumbers"
  | "wrapCodeLines"
  | "codeFontSize"
  | "terminalFont"
  | "inheritTerminalEnv"
  | "disableHardwareAcceleration"
  | "autoCheckUpdates"
  | "autoDownloadUpdates"
  | "advisorEnabled";

/** The `settings` field of a GET/PUT response, incl. server-formatted model refs. */
export type WebSettingsData =
  Record<string, unknown>
  & Partial<Pick<WebSettings, ScalarSettingKey>>
  & {
    titleModel?: WebSettings["titleModel"];
    commitModel?: WebSettings["commitModel"];
    titleModelRef?: string;
    advisorModel?: WebSettings["advisorModel"];
    commitModelRef?: string;
    lastChatModel?: WebSettings["lastChatModel"];
    modelRoles?: WebSettings["modelRoles"];
    modelRolesRefs?: { default?: string; smol?: string; plan?: string };
  };

/** Utility-model catalog entry (Settings page only). */
export type WebSettingsModelOption = {
  provider: string;
  modelId: string;
  name: string;
  supportsThinking: boolean;
  thinkingLevels: string[];
};

export type WebSettingsWithModels = {
  settings: WebSettingsData | null;
  models: WebSettingsModelOption[];
};

type Listener = () => void;

const listeners = new Set<Listener>();
let settings: WebSettingsData | null = null;
/** Serialized copy of `settings`, used to skip no-op notifications. */
let settingsJson = "";
/** Timestamp of the last successful read. */
let loadedAt = 0;
/** Timestamp of the last attempt (success or failure). */
let attemptedAt = 0;
let inFlight: Promise<WebSettingsData | null> | null = null;
let modelsInFlight: { key: string; promise: Promise<WebSettingsWithModels> } | null = null;

function emit(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* ignore */ }
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Cached settings; null until the first successful load. */
export function getWebSettings(): WebSettingsData | null {
  return settings;
}

/** SSR/hydration value — the cache is always empty on the server. */
function getServerWebSettings(): WebSettingsData | null {
  return null;
}

/**
 * Store a payload. Identical payloads keep the previous object identity so
 * `useSyncExternalStore` subscribers do not re-render on a no-op refresh.
 */
function commit(next: WebSettingsData, authoritative: boolean): void {
  if (authoritative) loadedAt = Date.now();
  const json = JSON.stringify(next);
  if (json === settingsJson) return;
  settingsJson = json;
  settings = next;
  emit();
}

/**
 * Adopt a full server payload (GET/PUT response) and restart the refresh
 * window — the caller just read authoritative state.
 */
export function applyWebSettings(next: WebSettingsData): void {
  commit(next, true);
}

/** Write a settings patch, optionally update the cache immediately, and adopt the server response. */
export async function saveWebSettings(
  patch: Record<string, unknown>,
  options?: { optimistic?: WebSettingsData },
): Promise<WebSettingsData | null> {
  if (options?.optimistic && settings !== null) {
    commit({ ...settings, ...options.optimistic }, false);
  }
  try {
    const res = await apiFetch("/api/web-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json() as { error?: string; settings?: WebSettingsData };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (data.settings) applyWebSettings(data.settings);
    return data.settings ?? null;
  } catch (error) {
    // The write may have reached disk before the response failed; re-read the
    // server value so optimistic consumers converge instead of staying stale.
    invalidateWebSettings();
    throw error;
  }
}

/**
 * Forget freshness and re-read in the background. Used after a write whose
 * result is unknown (failed PUT), so subscribers converge on the server value
 * instead of trusting an optimistic patch.
 */
export function invalidateWebSettings(): void {
  loadedAt = 0;
  attemptedAt = 0;
  void refreshWebSettings();
}

/**
 * Force a lightweight read. Concurrent callers share one request. Never
 * rejects: a failure leaves the previous value in place (consumers all treat a
 * missing value as "keep the current default").
 */
export function refreshWebSettings(): Promise<WebSettingsData | null> {
  if (inFlight) return inFlight;
  if (typeof window === "undefined") return Promise.resolve(settings);
  attemptedAt = Date.now();
  const request: Promise<WebSettingsData | null> = apiFetch(LIGHT_URL)
    .then(async (res) => {
      const data = await res.json() as { settings?: WebSettingsData; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.settings) applyWebSettings(data.settings);
      return settings;
    })
    .catch(() => settings)
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/**
 * Settings for callers that just need the current values. Resolves immediately
 * when something is cached (a stale copy is revalidated in the background) and
 * otherwise joins the read already on the wire, so a burst of mounts costs one
 * request at most.
 */
export function ensureWebSettings(): Promise<WebSettingsData | null> {
  const now = Date.now();
  if (settings !== null) {
    // Stale-while-revalidate: never make a caller wait on a second round trip.
    if (now - loadedAt >= REFRESH_MIN_MS && now - attemptedAt >= ERROR_BACKOFF_MS) {
      void refreshWebSettings();
    }
    return Promise.resolve(settings);
  }
  if (inFlight) return inFlight;
  // Nothing cached and a read just failed: keep the caller's defaults for now.
  if (now - attemptedAt < ERROR_BACKOFF_MS) return Promise.resolve(null);
  return refreshWebSettings();
}

/**
 * Full settings read for the Settings page.
 *
 * 1. Settings object from light runtime with `utilityModels=0` (never pull the
 *    agent SDK / createAgentSessionServices into light).
 * 2. Model catalog from `/api/models` (heavy) in parallel — optional for most
 *    panels; agent-model dropdowns fill when it arrives.
 *
 * `onSettings` fires as soon as the light settings payload is applied so the UI
 * can clear its loading spinner without waiting on the heavy model catalog.
 *
 * Pass `force: true` after a models mutation (disable/enable) so the heavy
 * process bypasses its 60s in-process catalog cache — light cannot invalidate
 * heavy's globalThis cache.
 */
export function fetchWebSettingsWithModels(
  cwd?: string | null,
  options?: {
    onSettings?: (settings: WebSettingsData | null) => void;
    /** Bypass heavy /api/models cache (maps to `?fresh=1`). */
    force?: boolean;
  },
): Promise<WebSettingsWithModels> {
  const settingsParams = new URLSearchParams({ utilityModels: "0" });
  if (cwd) settingsParams.set("cwd", cwd);
  const modelsParams = new URLSearchParams();
  if (cwd) modelsParams.set("cwd", cwd);
  if (options?.force) modelsParams.set("fresh", "1");
  const key = `${settingsParams}|${modelsParams}`;
  if (modelsInFlight && modelsInFlight.key === key) {
    // Shared flight: still deliver onSettings when the cached result resolves.
    return modelsInFlight.promise.then((result) => {
      options?.onSettings?.(result.settings);
      return result;
    });
  }

  const promise: Promise<WebSettingsWithModels> = (async () => {
    const settingsRes = await apiFetch(`/api/web-settings?${settingsParams.toString()}`);
    const settingsData = await settingsRes.json() as {
      settings?: WebSettingsData;
      error?: string;
    };
    if (!settingsRes.ok || settingsData.error) {
      throw new Error(settingsData.error ?? `HTTP ${settingsRes.status}`);
    }
    if (settingsData.settings) applyWebSettings(settingsData.settings);
    options?.onSettings?.(settingsData.settings ?? null);

    let models: WebSettingsModelOption[] = [];
    try {
      const modelsUrl = modelsParams.toString()
        ? `/api/models?${modelsParams.toString()}`
        : "/api/models";
      const modelsRes = await apiFetch(modelsUrl);
      const modelsBody = await modelsRes.json() as {
        modelList?: Array<{
          id: string;
          name?: string;
          provider: string;
        }>;
        thinkingLevels?: Record<string, string[]>;
        error?: string;
      };
      if (modelsRes.ok && !modelsBody.error) {
        const levels = modelsBody.thinkingLevels ?? {};
        models = (modelsBody.modelList ?? []).map((m) => {
          const keyRef = `${m.provider}/${m.id}`;
          const thinkingLevels = levels[keyRef] ?? levels[`${m.provider}:${m.id}`] ?? [];
          return {
            provider: m.provider,
            modelId: m.id,
            name: m.name || m.id,
            supportsThinking: thinkingLevels.some((level) => level && level !== "off"),
            thinkingLevels,
          };
        });
      }
    } catch {
      // Model catalog is optional for most settings sections.
      models = [];
    }

    return { settings: settingsData.settings ?? null, models };
  })();
  modelsInFlight = { key, promise };
  void promise
    .catch(() => {})
    .finally(() => {
      if (modelsInFlight?.promise === promise) modelsInFlight = null;
    });
  return promise;
}

/**
 * Subscribe to the shared settings. Returns null until the first load (callers
 * keep rendering their defaults, so there is no new loading state) and only
 * changes identity when the payload actually changed.
 */
export function useWebSettings(): WebSettingsData | null {
  useEffect(() => {
    void ensureWebSettings();
  }, []);
  return useSyncExternalStore(subscribe, getWebSettings, getServerWebSettings);
}
