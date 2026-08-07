/**
 * Shared types for ModelsConfig panels.
 */
import type { FreeProviderId } from "@/lib/free-providers";
import { PI_THINKING_LEVELS, type PiThinkingLevel } from "@/lib/thinking-level-map";

export interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

export interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** True when the same provider can also use OAuth (Anthropic, Copilot, …). */
  supportsOAuth?: boolean;
}

export type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  /** When true, model stays in models.json but is hidden from pickers. */
  disabled?: boolean;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  compat?: Record<string, unknown>;
}

export function normalizeModelEntry(model: ModelEntry): ModelEntry {
  const next: ModelEntry = { ...model };
  // Drop legacy cost / catalog-lock fields if present on disk.
  delete (next as { cost?: unknown }).cost;
  delete (next as { thinkingMapLocked?: unknown }).thinkingMapLocked;
  // Only persist disabled:true — omit the key when enabled.
  if (next.disabled) next.disabled = true;
  else delete next.disabled;
  return next;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
  /** Built-in free provider marker — models are remote-managed, toggle-only. */
  managed?: FreeProviderId | string;
}

export interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

export type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };



export type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string }
  | { type: "builtin-model"; providerId: string; modelId: string };

export const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

// ── Form field helpers ────────────────────────────────────────────────────────


export const THINKING_LEVELS = PI_THINKING_LEVELS;
export type ThinkingLevel = PiThinkingLevel;

export const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "var(--text-dim)",
  low:     "var(--text-muted)",
  medium:  "var(--text)",
  high:    "var(--text)",
  xhigh:   "var(--text)",
  max:     "var(--destructive)",
};


export type ProviderModelRow = {
  id: string;
  name: string;
  reasoning: boolean;
  /** True when the runtime did not identify reasoning support. */
  reasoningEditable?: boolean;
  supportsImage: boolean;
  disabled: boolean;
  contextWindow?: number;
  /** True when contextWindow is user-supplied or missing from the runtime. */
  contextWindowEditable?: boolean;
  maxTokens?: number;
  /** True when maxTokens is user-supplied or missing from the runtime. */
  maxTokensEditable?: boolean;
  input?: string[];
  thinkingLevelMap?: Record<string, string | null>;
  /** False when user may customize thinking map (no official map). */
  thinkingMapEditable?: boolean;
};
