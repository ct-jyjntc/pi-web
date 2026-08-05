/**
 * Shared app-update state for the main chrome badge + Settings "About" panel.
 * Auto-check runs once per page load when settings.autoCheckUpdates is true.
 */

import { ensureWebSettings } from "@/lib/web-settings-store";
import { apiFetch } from "@/lib/api-transport";

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  checkedAt: number;
};

type Listener = () => void;

let updateInfo: AppUpdateInfo | null = null;
let checking = false;
let autoCheckStarted = false;
const listeners = new Set<Listener>();

const STORAGE_KEY = "pi-web:app-update-available";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — avoid hammering GitHub

function emit() {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

function readCache(): AppUpdateInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUpdateInfo;
    if (!parsed?.latestVersion || !parsed?.releaseUrl || !parsed?.checkedAt) return null;
    if (Date.now() - parsed.checkedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(info: AppUpdateInfo | null) {
  if (typeof window === "undefined") return;
  try {
    if (!info) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  } catch {
    // ignore
  }
}

export function getAppUpdateInfo(): AppUpdateInfo | null {
  return updateInfo;
}

export function subscribeAppUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Apply a known result (e.g. from Settings manual check). */
export function setAppUpdateInfo(info: AppUpdateInfo | null): void {
  updateInfo = info;
  writeCache(info);
  emit();
}

export async function checkAppUpdate(options?: { force?: boolean }): Promise<AppUpdateInfo | null> {
  if (checking) return updateInfo;
  if (!options?.force && updateInfo && Date.now() - updateInfo.checkedAt < CACHE_TTL_MS) {
    return updateInfo;
  }
  // Hydrate from session cache first for instant badge after navigation.
  if (!options?.force && !updateInfo) {
    const cached = readCache();
    if (cached) {
      updateInfo = cached;
      emit();
    }
  }

  checking = true;
  emit();
  try {
    const res = await apiFetch("/api/app-update", { method: "POST" });
    const data = await res.json() as {
      currentVersion?: string;
      latestVersion?: string | null;
      updateAvailable?: boolean;
      releaseUrl?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok || data.error) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
      const info: AppUpdateInfo = {
        currentVersion: data.currentVersion ?? "",
        latestVersion: data.latestVersion,
        releaseUrl: data.releaseUrl,
        checkedAt: Date.now(),
      };
      updateInfo = info;
      writeCache(info);
      return info;
    }
    updateInfo = null;
    writeCache(null);
    return null;
  } catch {
    return updateInfo;
  } finally {
    checking = false;
    emit();
  }
}

/**
 * Start a background auto-check once per page load when the setting is on.
 * Safe to call multiple times.
 */
export function startAppUpdateAutoCheck(options?: {
  delayMs?: number;
  /** Called when an update is found (e.g. open release page). */
  onAvailable?: (info: AppUpdateInfo) => void;
}): void {
  if (autoCheckStarted || typeof window === "undefined") return;
  autoCheckStarted = true;

  // Instant badge from session cache
  const cached = readCache();
  if (cached) {
    updateInfo = cached;
    emit();
  }

  const delayMs = options?.delayMs ?? 8_000;
  window.setTimeout(() => {
    void (async () => {
      try {
        const settings = await ensureWebSettings();
        // Unreadable prefs: skip rather than risk an unwanted network check.
        if (!settings || settings.autoCheckUpdates === false) return;
        const info = await checkAppUpdate();
        if (info) {
          options?.onAvailable?.(info);
          if (settings?.autoDownloadUpdates) {
            window.open(info.releaseUrl, "_blank", "noopener,noreferrer");
          }
        }
      } catch {
        // silent
      }
    })();
  }, delayMs);
}
