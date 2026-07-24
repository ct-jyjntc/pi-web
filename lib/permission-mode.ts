import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type PermissionMode = "ask" | "full";

export interface PermissionModeState {
  mode: PermissionMode;
  yoloMode: boolean;
  configPath: string;
}

function globalConfigPath(): string {
  return join(getAgentDir(), "pi-permissions.jsonc");
}

function stripJsonc(raw: string): string {
  // Minimal JSONC strip: // line comments and /* */ blocks, then parse.
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readConfigObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(stripJsonc(raw)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function getPermissionMode(): PermissionModeState {
  const configPath = globalConfigPath();
  const config = readConfigObject(configPath);
  const yoloMode = config.yoloMode === true;
  return {
    mode: yoloMode ? "full" : "ask",
    yoloMode,
    configPath,
  };
}

export function setPermissionMode(mode: PermissionMode): PermissionModeState {
  const configPath = globalConfigPath();
  const existing = readConfigObject(configPath);
  const next = {
    ...existing,
    yoloMode: mode === "full",
  };
  mkdirSync(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, configPath);
  return {
    mode,
    yoloMode: mode === "full",
    configPath,
  };
}
