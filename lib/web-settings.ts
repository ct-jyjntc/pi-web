import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ModelRef = {
  provider: string;
  modelId: string;
};

export type WebSettings = {
  /** Model used for AI session title generation. null = session's current model. */
  titleModel: ModelRef | null;
  /** Model used for AI commit message generation. null = app default model. */
  commitModel: ModelRef | null;
};

const DEFAULT_SETTINGS: WebSettings = {
  titleModel: null,
  commitModel: null,
};

function getWebSettingsPath(): string {
  return join(getAgentDir(), "pi-web.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const merged: WebSettings = {
    ...readWebSettings(),
    ...next,
  };
  const normalized: WebSettings = {
    titleModel: parseModelRef(merged.titleModel),
    commitModel: parseModelRef(merged.commitModel),
  };
  const path = getWebSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
