import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ModelRef = {
  provider: string;
  modelId: string;
};

export type ThinkingLevelPref =
  | "auto"
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ThemeMode = "light" | "dark" | "system";

/** Prism theme keys we ship (see lib/syntax-highlighter.ts). */
export type CodeThemeId =
  | "vs"
  | "ghcolors"
  | "oneLight"
  | "vscDarkPlus"
  | "oneDark"
  | "materialDark";

/**
 * Pi Web app preferences (stored in ~/.pi/agent/pi-web.json).
 * Electron reads a subset at startup (proxy / CA / GPU).
 */
export type WebSettings = {
  /** Model used for AI session title generation. null = session's current model. */
  titleModel: ModelRef | null;
  /** Model used for AI commit message generation. null = app default model. */
  commitModel: ModelRef | null;

  // ── Network (restart recommended) ──
  /** HTTP(S) proxy URL, e.g. http://127.0.0.1:7890. Empty = direct. */
  httpProxy: string;
  /** Comma-separated NO_PROXY hosts. */
  proxyBypass: string;
  /** PEM root cert path for NODE_EXTRA_CA_CERTS. Empty = none. */
  customCaCerts: string;

  // ── Desktop / UX ──
  soundEnabled: boolean;
  desktopNotifications: boolean;
  notificationSound: boolean;
  /** Default thinking for new sessions. */
  defaultThinkingLevel: ThinkingLevelPref;
  /** Show thinking blocks expanded by default in the transcript. */
  showThinking: boolean;
  /** Show todo extension widgets by default (client preference). */
  showTodos: boolean;

  // ── Appearance ──
  themeMode: ThemeMode;
  /** UI text size in px (layout chrome stays fixed). */
  uiFontSize: number;
  codeThemeLight: CodeThemeId;
  codeThemeDark: CodeThemeId;
  showCodeLineNumbers: boolean;
  wrapCodeLines: boolean;
  /** Code block / file preview font size in px. */
  codeFontSize: number;

  // ── Terminal ──
  /** CSS font-family for xterm; empty = theme default mono stack. */
  terminalFont: string;
  /** Prefer login-shell environment for PTY/agent shells. */
  inheritTerminalEnv: boolean;

  // ── Electron ──
  /** Disable Chromium GPU acceleration (restart required). */
  disableHardwareAcceleration: boolean;
  /** Periodically check for app updates in the background. */
  autoCheckUpdates: boolean;
  /** When an update is found, open the release page automatically. */
  autoDownloadUpdates: boolean;
};

const DEFAULT_SETTINGS: WebSettings = {
  titleModel: null,
  commitModel: null,
  httpProxy: "",
  proxyBypass: "",
  customCaCerts: "",
  soundEnabled: true,
  desktopNotifications: true,
  notificationSound: true,
  defaultThinkingLevel: "auto",
  showThinking: true,
  showTodos: true,
  themeMode: "system",
  uiFontSize: 14,
  codeThemeLight: "vs",
  codeThemeDark: "vscDarkPlus",
  showCodeLineNumbers: true,
  wrapCodeLines: false,
  codeFontSize: 12.5,
  terminalFont: "",
  inheritTerminalEnv: true,
  disableHardwareAcceleration: false,
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
};

const CODE_THEME_IDS = new Set<CodeThemeId>([
  "vs",
  "ghcolors",
  "oneLight",
  "vscDarkPlus",
  "oneDark",
  "materialDark",
]);

const THEME_MODES = new Set<ThemeMode>(["light", "dark", "system"]);

const THINKING_LEVELS = new Set<ThinkingLevelPref>([
  "auto", "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

export function getWebSettingsPath(): string {
  return join(getAgentDir(), "pi-web.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asThinking(value: unknown, fallback: ThinkingLevelPref): ThinkingLevelPref {
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevelPref)) {
    return value as ThinkingLevelPref;
  }
  return fallback;
}

function asThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
  if (typeof value === "string" && THEME_MODES.has(value as ThemeMode)) return value as ThemeMode;
  return fallback;
}

function asCodeTheme(value: unknown, fallback: CodeThemeId): CodeThemeId {
  if (typeof value === "string" && CODE_THEME_IDS.has(value as CodeThemeId)) return value as CodeThemeId;
  return fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseModelRef(value: unknown): ModelRef | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) return null;
    return {
      provider: trimmed.slice(0, slash).trim(),
      modelId: trimmed.slice(slash + 1).trim(),
    };
  }
  if (!isRecord(value)) return null;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string"
    ? value.modelId.trim()
    : typeof value.id === "string"
      ? value.id.trim()
      : "";
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

export function formatModelRef(ref: ModelRef | null | undefined): string {
  if (!ref) return "";
  return `${ref.provider}/${ref.modelId}`;
}

function normalizeWebSettings(raw: unknown): WebSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  return {
    titleModel: parseModelRef(raw.titleModel),
    commitModel: parseModelRef(raw.commitModel),
    httpProxy: asString(raw.httpProxy),
    proxyBypass: asString(raw.proxyBypass),
    customCaCerts: asString(raw.customCaCerts),
    soundEnabled: asBool(raw.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    desktopNotifications: asBool(raw.desktopNotifications, DEFAULT_SETTINGS.desktopNotifications),
    notificationSound: asBool(raw.notificationSound, DEFAULT_SETTINGS.notificationSound),
    defaultThinkingLevel: asThinking(raw.defaultThinkingLevel, DEFAULT_SETTINGS.defaultThinkingLevel),
    showThinking: asBool(raw.showThinking, DEFAULT_SETTINGS.showThinking),
    showTodos: asBool(raw.showTodos, DEFAULT_SETTINGS.showTodos),
    themeMode: asThemeMode(raw.themeMode, DEFAULT_SETTINGS.themeMode),
    uiFontSize: asNumber(raw.uiFontSize, DEFAULT_SETTINGS.uiFontSize, 12, 18),
    codeThemeLight: asCodeTheme(raw.codeThemeLight, DEFAULT_SETTINGS.codeThemeLight),
    codeThemeDark: asCodeTheme(raw.codeThemeDark, DEFAULT_SETTINGS.codeThemeDark),
    showCodeLineNumbers: asBool(raw.showCodeLineNumbers, DEFAULT_SETTINGS.showCodeLineNumbers),
    wrapCodeLines: asBool(raw.wrapCodeLines, DEFAULT_SETTINGS.wrapCodeLines),
    codeFontSize: asNumber(raw.codeFontSize, DEFAULT_SETTINGS.codeFontSize, 10, 18),
    terminalFont: asString(raw.terminalFont),
    inheritTerminalEnv: asBool(raw.inheritTerminalEnv, DEFAULT_SETTINGS.inheritTerminalEnv),
    disableHardwareAcceleration: asBool(
      raw.disableHardwareAcceleration,
      DEFAULT_SETTINGS.disableHardwareAcceleration,
    ),
    autoCheckUpdates: asBool(raw.autoCheckUpdates, DEFAULT_SETTINGS.autoCheckUpdates),
    autoDownloadUpdates: asBool(raw.autoDownloadUpdates, DEFAULT_SETTINGS.autoDownloadUpdates),
  };
}

export function readWebSettings(): WebSettings {
  const path = getWebSettingsPath();
  try {
    if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return normalizeWebSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeWebSettings(next: Partial<WebSettings>): WebSettings {
  const current = readWebSettings();
  const merged: WebSettings = {
    ...current,
    ...next,
  };
  const normalized = normalizeWebSettings(merged);
  const path = getWebSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

/** Env vars Electron / Node should apply from web settings. */
export function webSettingsToProcessEnv(settings: WebSettings): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  const proxy = settings.httpProxy.trim();
  if (proxy) {
    env.HTTP_PROXY = proxy;
    env.http_proxy = proxy;
    env.HTTPS_PROXY = proxy;
    env.https_proxy = proxy;
    env.ALL_PROXY = proxy;
    env.all_proxy = proxy;
  } else {
    // Explicit clear so a previous launch value is not sticky in the same process.
    env.HTTP_PROXY = "";
    env.http_proxy = "";
    env.HTTPS_PROXY = "";
    env.https_proxy = "";
    env.ALL_PROXY = "";
    env.all_proxy = "";
  }
  const bypass = settings.proxyBypass.trim();
  if (bypass) {
    env.NO_PROXY = bypass;
    env.no_proxy = bypass;
  } else if (proxy) {
    env.NO_PROXY = "localhost,127.0.0.1,::1";
    env.no_proxy = env.NO_PROXY;
  }
  const ca = settings.customCaCerts.trim();
  if (ca) env.NODE_EXTRA_CA_CERTS = ca;
  else env.NODE_EXTRA_CA_CERTS = "";
  return env;
}
