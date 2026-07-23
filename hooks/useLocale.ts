"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isLocale, translate, type Locale, type MessageKey, type TranslateParams } from "@/lib/i18n/messages";

const STORAGE_KEY = "pi-locale";
const listeners = new Set<() => void>();

function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

function detectBrowserLocale(): Locale {
  try {
    const lang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || "en";
    return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function getSnapshot(): Locale {
  if (typeof document === "undefined") return "en";
  const fromHtml = document.documentElement.lang;
  if (isLocale(fromHtml)) return fromHtml;
  return readStoredLocale() ?? detectBrowserLocale();
}

function getServerSnapshot(): Locale {
  return "en";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function applyLocale(next: Locale) {
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
  listeners.forEach((cb) => cb());
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLocale = useCallback((next: Locale) => {
    if (next === getSnapshot()) return;
    applyLocale(next);
  }, []);

  const toggleLocale = useCallback(() => {
    applyLocale(getSnapshot() === "zh" ? "en" : "zh");
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: TranslateParams) => translate(locale, key, params),
    [locale],
  );

  return { locale, setLocale, toggleLocale, t, isZh: locale === "zh" };
}
