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
    const res = await fetch("/api/web-settings", {
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
  const request: Promise<WebSettingsData | null> = fetch(LIGHT_URL)
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
 * Full read including the utility-model catalog — only the Settings page needs
 * `models`. The catalog is handed to the caller instead of being cached, so a
 * lightweight refresh can never clobber it; `settings` does not depend on `cwd`
 * and still feeds the shared snapshot. Rejects on error so the panel can show it.
 */
export function fetchWebSettingsWithModels(cwd?: string | null): Promise<WebSettingsWithModels> {
  const params = new URLSearchParams();
  if (cwd) params.set("cwd", cwd);
  const key = params.toString();
  if (modelsInFlight && modelsInFlight.key === key) return modelsInFlight.promise;

  const promise: Promise<WebSettingsWithModels> = (async () => {
    const res = await fetch(`/api/web-settings?${key}`);
    const data = await res.json() as {
      settings?: WebSettingsData;
      models?: WebSettingsModelOption[];
      error?: string;
    };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (data.settings) applyWebSettings(data.settings);
    return { settings: data.settings ?? null, models: data.models ?? [] };
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
