"use client";

import { useLocale } from "@/hooks/useLocale";

import { useState, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ConfigPanelBackdrop, ConfigPanelShell } from "./ConfigPanelShell";
import {
  FREE_PROVIDERS,
  getFreeProvider,
  isFreeManagedProvider,
  type FreeProviderDefinition,
  type FreeProviderId,
} from "@/lib/free-providers";
import {
  TOKENRHYTHM_ICON_URL,
  TOKENRHYTHM_PROVIDER_ID,
} from "@/lib/tokenrhythm-constants";
import { SettingsToggle } from "./SettingsToggle";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
// Color icons (have their own fill colors — no background needed)
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";

type IconComponent = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

// hasColor=true → Color icon (self-colored SVG, no wrapper)
// hasColor=false → Mono icon (rendered with currentColor, inherits theme text color)
const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  "anthropic":              { Icon: AnthropicIcon,        hasColor: false },
  "openai":                 { Icon: OpenAIIcon,           hasColor: false },
  "openai-codex":           { Icon: OpenAIIcon,           hasColor: false },
  "google":                 { Icon: GoogleColorIcon,      hasColor: true },
  "google-vertex":          { Icon: GoogleColorIcon,      hasColor: true },
  "ant-ling":               { Icon: AntGroupColorIcon,    hasColor: true },
  "deepseek":               { Icon: DeepSeekColorIcon,    hasColor: true },
  "groq":                   { Icon: GroqIcon,             hasColor: false },
  "mistral":                { Icon: MistralColorIcon,     hasColor: true },
  "moonshotai":             { Icon: MoonshotIcon,         hasColor: false },
  "moonshotai-cn":          { Icon: MoonshotIcon,         hasColor: false },
  "moonshot":               { Icon: MoonshotIcon,         hasColor: false },
  "minimax":                { Icon: MinimaxColorIcon,     hasColor: true },
  "minimax-cn":             { Icon: MinimaxColorIcon,     hasColor: true },
  "fireworks":              { Icon: FireworksColorIcon,   hasColor: true },
  "huggingface":            { Icon: HuggingFaceColorIcon, hasColor: true },
  "cerebras":               { Icon: CerebrasColorIcon,    hasColor: true },
  "openrouter":             { Icon: OpenRouterIcon,       hasColor: false },
  "xai":                    { Icon: XAIIcon,              hasColor: false },
  "cloudflare-ai-gateway":  { Icon: CloudflareColorIcon,  hasColor: true },
  "cloudflare-workers-ai":  { Icon: CloudflareColorIcon,  hasColor: true },
  "vercel-ai-gateway":      { Icon: VercelIcon,           hasColor: false },
  "github-copilot":         { Icon: GithubCopilotIcon,    hasColor: false },
  "amazon-bedrock":         { Icon: AwsColorIcon,         hasColor: true },
  "azure-openai-responses": { Icon: AzureColorIcon,       hasColor: true },
  "kimi-coding":            { Icon: KimiColorIcon,        hasColor: true },
  "nvidia":                 { Icon: NvidiaColorIcon,      hasColor: true },
  "opencode":               { Icon: OpenCodeIcon,         hasColor: false },
  "opencode-go":            { Icon: OpenCodeIcon,         hasColor: false },
  "qwen":                   { Icon: QwenColorIcon,        hasColor: true },
  "xiaomi":                 { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-ams":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-cn":   { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-sgp":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "zai":                    { Icon: ZAIIcon,              hasColor: false },
  "zai-coding-cn":          { Icon: ZAIIcon,              hasColor: false },
  "zhipu":                  { Icon: ZhipuColorIcon,       hasColor: true },
  "cohere":                 { Icon: CohereColorIcon,      hasColor: true },
  "perplexity":             { Icon: PerplexityColorIcon,  hasColor: true },
  "together":               { Icon: TogetherColorIcon,    hasColor: true },
  "grok":                   { Icon: GrokIcon,             hasColor: false },
};

/** Local monochrome brand marks (not lobehub). */
const PROVIDER_ICON_URLS: Record<string, string> = {
  [TOKENRHYTHM_PROVIDER_ID]: TOKENRHYTHM_ICON_URL,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** True when the same provider can also use OAuth (Anthropic, Copilot, …). */
  supportsOAuth?: boolean;
}

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

interface ModelEntry {
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
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
}

/** Cost must always include all four numbers — blank/missing → 0 (never omit keys). */
type ModelCost = { input: number; output: number; cacheRead: number; cacheWrite: number };

function parseCostNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function normalizeModelCost(cost?: ModelEntry["cost"] | null): ModelCost {
  return {
    input: parseCostNumber(cost?.input),
    output: parseCostNumber(cost?.output),
    cacheRead: parseCostNumber(cost?.cacheRead),
    cacheWrite: parseCostNumber(cost?.cacheWrite),
  };
}

function normalizeModelEntry(model: ModelEntry): ModelEntry {
  const next: ModelEntry = { ...model, cost: normalizeModelCost(model.cost) };
  // Only persist disabled:true — omit the key when enabled.
  if (next.disabled) next.disabled = true;
  else delete next.disabled;
  return next;
}

interface ProviderEntry {
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

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="modal-field">
      <label className="modal-field-label">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className={`input-base${mono ? " input-mono" : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`input-base${mono ? " input-mono" : ""}`}
        style={{ paddingRight: 34 }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("models.hideKey") : t("models.showKey")}
        title={visible ? t("models.hideKey") : t("models.showKey")}
        className="icon-btn"
        style={{
          "--icon-btn-size": "24px",
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
        } as React.CSSProperties}
      >
        {visible ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
            <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="number" className="input-base" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="input-base"
      style={{ color: value ? "var(--text)" : "var(--text-dim)" }}>
      {!required && <option value="">— inherit / none —</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="modal-section-title">{children}</div>;
}

/** Detail strip: title left, actions right — matches app chrome headers */
function DetailStrip({
  title,
  actions,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="modal-detail-strip">
      <SectionTitle>{title}</SectionTitle>
      {actions ? <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}

/** Sidebar nav row class — same grammar as session/git lists */
function navRowClass(selected: boolean, child = false): string {
  return `modal-nav-item${selected ? " is-active" : ""}${child ? " is-child" : ""}`;
}

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({
  name, provider, onChange, onRename, onDelete, onAddModels, onRefreshModels, refreshingModels, refreshError,
}: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void;
  onRefreshModels?: () => void;
  refreshingModels?: boolean;
  refreshError?: string | null;
}) {
  const { t } = useLocale();
  const freeDef = getFreeProvider(typeof provider.managed === "string" ? provider.managed : undefined);
  const managed = !!freeDef;
  const [editingName, setEditingName] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
  useEffect(() => setEditingName(name), [name]);
  useEffect(() => setConfirmDelete(false), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!managed && !provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api, managed]);

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  const handleDiscoverModels = useCallback(async () => {
    if (managed || !provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== discoveryRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setDiscoveryState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [discoveryState.phase, managed, name, provider]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, overflow: "auto" }}>
      <DetailStrip
        title={managed ? t("models.freeProvider") : t("models.provider")}
        actions={confirmDelete ? (
          <>
            <span style={{ fontSize: 11, color: "var(--destructive)" }}>{t("models.confirmDeleteProvider")}</span>
            <button type="button" className="btn-danger btn-compact" onClick={onDelete}>{t("common.delete")}</button>
            <button type="button" className="btn-ghost btn-compact" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
          </>
        ) : (
          <>
            {managed && onRefreshModels && (
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={onRefreshModels}
                disabled={refreshingModels}
                title={t("models.refreshFreeModels")}
              >
                {refreshingModels ? t("models.refreshingModels") : t("models.refreshModels")}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={() => setConfirmDelete(true)}
              style={{ color: "var(--destructive)", borderColor: "var(--destructive-border)" }}
            >
              {t("common.delete")}
            </button>
          </>
        )}
      />

      {managed && freeDef && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            lineHeight: 1.45,
          }}
        >
          {t("models.freeProviderNotice")}
        </div>
      )}

      {refreshError && (
        <div style={{ fontSize: 12, color: "var(--destructive)" }}>{refreshError}</div>
      )}

      <Field label={t("models.providerName")}>
        {managed ? (
          <div className="input-base" style={{ opacity: 0.85, cursor: "default" }}>
            {freeDef?.displayName ?? name}
          </div>
        ) : (
          <>
            <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
            {editingName !== name && editingName.trim() && (
              <button type="button" className="btn-primary btn-compact" onClick={() => onRename(editingName.trim())} style={{ marginTop: 6, alignSelf: "flex-start" }}>
                {t("common.rename")}
              </button>
            )}
          </>
        )}
      </Field>

      <Field label={t("models.baseUrl")}>
        {managed ? (
          <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>
            {provider.baseUrl || freeDef?.baseUrl}
          </div>
        ) : (
          <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
            placeholder="https://api.example.com/v1" mono />
        )}
      </Field>

      {!managed && (
        <Field label={t("models.apiKey")}>
          <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
            placeholder={t("models.apiKeyPlaceholder")} mono />
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
            {t("models.apiKeyHint")}
          </span>
        </Field>
      )}

      <Field label={t("models.api")}>
        {managed ? (
          <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>
            {provider.api || freeDef?.api}
          </div>
        ) : (
          <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
        )}
      </Field>

      {!managed && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {discoveryState.phase !== "success" && (
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={() => void handleDiscoverModels()}
              disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
              style={{ alignSelf: "flex-start" }}
            >
              {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}
            </button>
          )}

          {discoveryState.phase === "error" && (
            <div style={{
              padding: "7px 9px",
              border: "1px solid var(--destructive-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--destructive-bg)",
              color: "var(--destructive)",
              fontSize: 11,
              lineHeight: 1.4,
            }}>
              {discoveryState.message}
            </div>
          )}

          {discoveryState.phase === "success" && (
            <>
              <input
                value={discoveryQuery}
                onChange={(event) => setDiscoveryQuery(event.target.value)}
                placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
                aria-label={t("models.discoveryFilter")}
                className="input-base"
                style={{ width: "100%", minWidth: 0, borderRadius: 0 }}
              />

              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", background: "var(--bg-panel)" }}>
                <label
                  style={{
                    minHeight: 32, padding: "5px 9px", display: "flex", alignItems: "center", gap: 8,
                    position: "sticky", top: 0, zIndex: 1, borderBottom: "1px solid var(--border)",
                    background: "var(--bg)", cursor: selectableShownIds.length ? "pointer" : "default",
                    color: "var(--text-muted)", fontSize: 10, fontWeight: 600,
                  }}
                >
                  <input
                    ref={selectShownRef}
                    type="checkbox"
                    checked={allShownSelected}
                    disabled={selectableShownIds.length === 0}
                    onChange={toggleShownModels}
                    style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                  />
                  {t("models.discoverySelectShown")}
                </label>
                {shownDiscoveredModels.length === 0 ? (
                  <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 11 }}>{t("models.discoveryNoMatches")}</div>
                ) : shownDiscoveredModels.map((model, index) => {
                  const alreadyAdded = existingModelIds.has(model.id);
                  const checked = selectedModelIds.includes(model.id);
                  return (
                    <label
                      key={model.id}
                      style={{
                        minHeight: 36, padding: "6px 9px", display: "flex", alignItems: "center", gap: 8,
                        borderTop: index === 0 ? "none" : "1px solid var(--border)", cursor: alreadyAdded ? "default" : "pointer",
                        opacity: alreadyAdded ? 0.65 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked || alreadyAdded}
                        disabled={alreadyAdded}
                        onChange={() => toggleDiscoveredModel(model.id)}
                        style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                      />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 11 }}>{model.name ?? model.id}</span>
                        {model.name && <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{model.id}</code>}
                      </span>
                      {alreadyAdded && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{t("models.discoveryAdded")}</span>}
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span title={discoveryState.endpoint} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>
                  {filteredDiscoveredModels.length > shownDiscoveredModels.length
                    ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                    : t("models.discoveryFetched", { count: discoveryState.models.length })}
                </span>
                <button
                  type="button"
                  className={selectedCount ? "btn-primary btn-compact" : "btn-ghost btn-compact"}
                  onClick={addSelectedModels}
                  disabled={selectedCount === 0}
                >
                  {selectedCount
                    ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                    : t("models.discoveryAddSelected")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {managed && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {(provider.models ?? []).length} {t("models.freeModelCount")}
          {" · "}
          {(provider.models ?? []).filter((m) => !m.disabled).length} {t("models.enabledCount")}
        </div>
      )}
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "var(--text-dim)",
  low:     "var(--text-muted)",
  medium:  "var(--text)",
  high:    "var(--text)",
  xhigh:   "var(--text)",
  max:     "var(--destructive)",
};

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useLocale();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            {/* Level badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" ? 0.3 : 1 }} />
              <span style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: state === "null" ? "var(--text-dim)" : "var(--text-muted)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>

            {/* Default + Disabled buttons */}
            <div className="settings-segmented" style={{ minWidth: 0, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setLevel(level, "omit")}
                className={`chrome-btn${state === "omit" ? " is-active" : ""}`}
              >
                {t("models.thinkingDefault")}
              </button>
              <button
                type="button"
                onClick={() => setLevel(level, null)}
                className={`chrome-btn${state === "null" ? " is-active" : ""}`}
              >
                {t("models.thinkingDisabled")}
              </button>
            </div>

            {/* Custom button + input fused */}
            <div className="settings-segmented" style={{ minWidth: 0 }}>
              <button
                type="button"
                onClick={() => setLevel(level, strVal || level)}
                className={`chrome-btn${state === "string" ? " is-active" : ""}`}
                style={{ flexShrink: 0 }}
              >
                {t("models.custom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: "transparent",
                  border: "none",
                  color: state === "string" ? "var(--text)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  padding: "0 8px",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  const next = { ...model };
  let appliedCount = 0;
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }
  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) } as ModelCost;
    let costChanged = false;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key]!;
        costChanged = true;
        appliedCount += 1;
      }
    }
    if (costChanged) next.cost = normalizeModelCost(cost);
  }
  return { model: next, appliedCount };
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
  managed = false,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
  /** Free/managed models: enable/disable only — no field edits or remove. */
  managed?: boolean;
}) {
  const { t } = useLocale();
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const costVal = (k: keyof ModelCost) => {
    const n = model.cost?.[k];
    return n !== undefined && n !== null ? String(n) : "";
  };
  const setCost = (k: keyof ModelCost, v: string) => {
    // Empty / invalid → 0; always keep full cost object with all four keys.
    const next = normalizeModelCost({ ...(model.cost ?? {}), [k]: v.trim() === "" ? 0 : parseCostNumber(v) });
    onChange({ ...model, cost: next });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("models.testingConnection");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("modal.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return [t("modal.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, provider.baseUrl, model.id]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  const handleCatalogFill = useCallback(async () => {
    const query = model.id.trim();
    if (managed || !query || catalogState.phase === "loading") return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ q: query, provider: providerName, limit: "50" });
      if (provider.baseUrl?.trim()) params.set("baseUrl", provider.baseUrl.trim());
      const res = await fetch(`/api/models-config/catalog?${params}`);
      const data = await res.json() as { recommendation?: ModelCatalogRecommendation; error?: string };
      if (requestId !== catalogRequestIdRef.current) return;
      if (!res.ok || data.error || !data.recommendation) {
        setCatalogState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const filled = fillEmptyModelFields(model, data.recommendation.preset);
      if (filled.appliedCount > 0) {
        catalogUndoRef.current = model;
        onChange(filled.model);
      }
      setCatalogState({
        phase: "success",
        recommendation: data.recommendation,
        appliedCount: filled.appliedCount,
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [catalogState.phase, managed, model, onChange, provider.baseUrl, providerName]);

  const undoCatalogFill = () => {
    const previous = catalogUndoRef.current;
    if (!previous) return;
    catalogUndoRef.current = null;
    onChange(previous);
    setCatalogState({ phase: "idle" });
  };

  const catalogResultSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("models.catalogFilled", { count: appliedCount })
      : t("models.catalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      const price = recommendation.price.reason === "no-exact-match"
        ? t("models.catalogNoExactMatch")
        : t("models.catalogPriceUnreliable");
      return `${applied} · ${price}`;
    }
    const price = recommendation.price.method === "provider"
      ? t("models.catalogPriceProvider", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
      : recommendation.price.method === "base-url"
        ? t("models.catalogPriceBaseUrl", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
        : t("models.catalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();
  const catalogStatusText = catalogState.phase === "error"
    ? catalogState.message
    : catalogResultSummary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, overflow: "auto" }}>
      <DetailStrip
        title={t("models.model")}
        actions={(
          <>
          {!managed && (
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={() => void handleCatalogFill()}
              disabled={!model.id.trim() || catalogState.phase === "loading"}
              title={t("models.catalogFill")}
            >
              {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
            </button>
          )}
          {catalogState.phase === "success" && catalogUndoRef.current && (
            <button type="button" className="btn-ghost btn-compact" onClick={undoCatalogFill}>
              {t("models.catalogUndo")}
            </button>
          )}
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 220,
                height: 26,
                padding: "0 8px",
                border: `1px solid ${testState.phase === "error" ? "var(--destructive-border)" : testState.phase === "success" ? "var(--success-border)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                background: testState.phase === "error" ? "var(--destructive-bg)" : testState.phase === "success" ? "var(--success-bg)" : "var(--bg)",
                color: "var(--text)",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            type="button"
            className="btn-ghost btn-compact"
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title={t("models.testConnection")}
            style={{
              background: testState.phase === "success" ? "var(--success)" : undefined,
              borderColor: testState.phase === "success" ? "var(--success)" : undefined,
              color: testState.phase === "success" ? "var(--accent-fg)" : undefined,
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {testState.phase === "testing" ? t("modal.testing") : testState.phase === "success" ? t("modal.ok") : t("modal.test")}
          </button>
          {!managed && (
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={onDelete}
              style={{ color: "var(--destructive)", borderColor: "var(--destructive-border)" }}
            >
              {t("modal.remove")}
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 2 }}>
            <span style={{ fontSize: 11, color: model.disabled ? "var(--text-dim)" : "var(--text-muted)" }}>
              {model.disabled ? t("models.disabled") : t("models.enabled")}
            </span>
            <SettingsToggle
              enabled={!model.disabled}
              title={model.disabled ? t("models.enableHint") : t("models.disableHint")}
              onChange={(on) => set("disabled", on ? undefined : true)}
            />
          </div>
          </>
        )}
      />

      {catalogStatusText && (
        <div
          style={{
            fontSize: 12,
            color: catalogState.phase === "error" ? "var(--destructive)" : "var(--text-muted)",
            background: catalogState.phase === "error" ? "var(--destructive-bg)" : "var(--bg-subtle)",
            border: `1px solid ${catalogState.phase === "error" ? "var(--destructive-border)" : "var(--border)"}`,
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            lineHeight: 1.45,
          }}
        >
          {catalogStatusText}
        </div>
      )}

      {managed && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            lineHeight: 1.45,
          }}
        >
          {t("models.freeModelNotice")}
        </div>
      )}

      {model.disabled && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
          }}
        >
          {t("models.disabledNotice")}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: managed ? "1fr" : "1fr 1fr", gap: 10 }}>
        <Field label={t("models.idRequired")}>
          {managed ? (
            <div className="input-base input-mono" style={{ opacity: 0.85, cursor: "default" }}>{model.id}</div>
          ) : (
            <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono />
          )}
        </Field>
        {!managed && (
          <Field label={t("shell.name")}><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("models.displayName")} /></Field>
        )}
      </div>

      {managed ? null : (
      <>

      <Field label={t("models.apiOverride")}>
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check label={t("models.reasoning")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
        <Check label={t("models.imageInput")} checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
      </div>

      {model.reasoning && (
        <>
          <Check
            label={t("models.deepseekCompat")}
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <SectionTitle>{t("models.thinkingMap")}</SectionTitle>
              {model.thinkingLevelMap && (
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={() => set("thinkingLevelMap", undefined)}
                >
                  {t("models.clearAll")}
                </button>
              )}
            </div>
            <ThinkingLevelMapEditor
              value={model.thinkingLevelMap}
              onChange={(v) => set("thinkingLevelMap", v)}
            />
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("models.contextWindow")}>
          <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
        </Field>
        <Field label={t("models.maxOutput")}>
          <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
        </Field>
      </div>

      <div>
        <SectionTitle>{t("models.cost")}</SectionTitle>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <Field key={k} label={k}>
              <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
            </Field>
          ))}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

// ── Built-in provider model list (API key / OAuth) ────────────────────────────

type ProviderModelRow = {
  id: string;
  name: string;
  reasoning: boolean;
  supportsImage: boolean;
  disabled: boolean;
};

function ProviderModelsPanel({
  providerId,
  active,
  onModelsChanged,
}: {
  providerId: string;
  /** Only load when the provider is configured / logged in. */
  active: boolean;
  onModelsChanged?: () => void;
}) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ProviderModelRow[]>([]);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active) {
      setModels([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/models-config/provider-models?provider=${encodeURIComponent(providerId)}`);
      const data = await res.json() as { models?: ProviderModelRow[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (e) {
      setModels([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [active, providerId]);

  useEffect(() => {
    setSearch("");
    void load();
  }, [load]);

  const toggle = useCallback(async (model: ProviderModelRow, enabled: boolean) => {
    setPendingId(model.id);
    setError(null);
    // Optimistic update
    setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, disabled: !enabled } : m)));
    try {
      const res = await fetch("/api/models-config/provider-models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, modelId: model.id, disabled: !enabled }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      onModelsChanged?.();
    } catch (e) {
      // Revert
      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, disabled: model.disabled } : m)));
      setError(e instanceof Error ? e.message : t("models.providerModelToggleError"));
    } finally {
      setPendingId(null);
    }
  }, [onModelsChanged, providerId, t]);

  if (!active) return null;

  const q = search.trim().toLowerCase();
  const filtered = !q
    ? models
    : models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  const enabledCount = models.filter((m) => !m.disabled).length;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("models.providerModels")}</div>
        {!loading && models.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {models.length} {t("models.freeModelCount")}
            {" · "}
            {enabledCount} {t("models.enabledCount")}
          </div>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45, flexShrink: 0 }}>
        {t("models.providerModelsHint")}
      </p>

      {models.length > 8 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("models.searchProviderModels")}
          className="input-base"
          style={{ fontSize: 12, flexShrink: 0 }}
        />
      )}

      {loading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{t("models.loadingProviderModels")}</div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "var(--destructive)", flexShrink: 0 }}>{error}</div>
      )}

      {!loading && !error && models.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{t("models.noProviderModels")}</div>
      )}

      {!loading && filtered.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
          }}
        >
          {filtered.map((model) => (
            <div
              key={model.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderBottom: "1px solid var(--border)",
                opacity: model.disabled ? 0.65 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {model.name}
                </div>
                <div
                  className="input-mono"
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                >
                  {model.id}
                  {model.reasoning ? " · T" : ""}
                  {model.supportsImage ? " · img" : ""}
                </div>
              </div>
              <span style={{ fontSize: 10, color: model.disabled ? "var(--text-dim)" : "var(--text-muted)", flexShrink: 0 }}>
                {model.disabled ? t("models.disabled") : t("models.enabled")}
              </span>
              <SettingsToggle
                enabled={!model.disabled}
                loading={pendingId === model.id}
                title={model.disabled ? t("models.enableHint") : t("models.disableHint")}
                onChange={(on) => void toggle(model, on)}
              />
            </div>
          ))}
        </div>
      )}

      {!loading && models.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("models.noProvidersMatch")}</div>
      )}
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({ provider, onRefresh, onModelsChanged }: { provider: OAuthProvider; onRefresh: () => void; onModelsChanged?: () => void }) {
  const { t } = useLocale();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: t("models.connectionLost") });
    };
  }, [provider.id, onRefresh]);

  const handleLogout = useCallback(async () => {
    await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
    setLoginState({ phase: "idle" });
    onRefresh();
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: t("models.verifying") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("models.networkError") });
    }
  }, [provider.id]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: t("models.continuing") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("models.networkError") });
    }
  }, [provider.id]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, overflow: "hidden" }}>
      <DetailStrip
        title={t("models.subscription")}
        actions={(
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "var(--success)" : "var(--border)", display: "inline-block" }} />
            <span style={{ fontSize: 11, color: provider.loggedIn ? "var(--success)" : "var(--text-dim)" }}>
              {provider.loggedIn ? t("models.statusConnected") : t("models.statusNotConnected")}
            </span>
          </div>
        )}
      />

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {provider.loggedIn ? t("models.alreadyConnected") : t("models.connectAccount", { name: provider.name })}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("models.openingBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? t("models.pasteRedirectUrl")
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {t("models.openLoginFallback")}{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                  {t("models.openLoginLink")}
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? t("models.enterValue"))}
                className="input-base input-mono"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-primary btn-compact"
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ flexShrink: 0 }}
              >
                Submit
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("models.deviceCodeHint")}
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` ${t("models.expiresInMinutes", { n: Math.ceil(loginState.expiresInSeconds / 60) })}` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--success)" }}>{t("models.connectedOk")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--destructive)" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            type="button"
            className="btn-ghost btn-compact"
            onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary btn-compact"
              onClick={handleLogin}
            >
              {provider.loggedIn ? t("modal.relogin") : t("modal.login")}
            </button>
            {provider.loggedIn && (
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={handleLogout}
                style={{ color: "var(--destructive)", borderColor: "var(--destructive-border)" }}
              >
                Disconnect
              </button>
            )}
          </>
        )}
      </div>

      <ProviderModelsPanel
        providerId={provider.id}
        active={provider.loggedIn}
        onModelsChanged={onModelsChanged}
      />
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({ provider, onRefresh, onModelsChanged }: { provider: ApiKeyProvider; onRefresh: () => void; onModelsChanged?: () => void }) {
  const { t } = useLocale();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0, overflow: "hidden" }}>
      <DetailStrip
        title={t("models.apiKey")}
        actions={(
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "var(--success)" : "var(--border)", display: "inline-block" }} />
            <span style={{ fontSize: 11, color: provider.configured ? "var(--success)" : "var(--text-dim)" }}>
              {provider.configured ? t("models.statusConfigured") : t("models.statusNotConfigured")}
            </span>
          </div>
        )}
      />

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? t("models.apiKeyStored")
          : t("models.enterApiKey")}
      </p>

      <Field label={t("models.apiKey")}>
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? t("models.enterNewKey") : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            type="button"
            className="btn-primary btn-compact"
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              flexShrink: 0,
              background: savedOk ? "var(--success)" : undefined,
              animation: savedOk ? "saved-pop 0.45s ease" : undefined,
            }}
          >
            {savedOk && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? t("common.saved") : saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "var(--destructive)" }}>{error}</p>}

      {provider.configured && (
        <button
          type="button"
          className="btn-ghost btn-compact"
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start",
            color: "var(--destructive)",
            borderColor: "var(--destructive-border)",
          }}
        >
          {removing ? t("modal.removing") : t("modal.disconnect")}
        </button>
      )}

      <ProviderModelsPanel
        providerId={provider.id}
        active={provider.configured}
        onModelsChanged={onModelsChanged}
      />
    </div>
  );
}

// ── Provider icon ─────────────────────────────────────────────────────────────

function ProviderIcon({ id, size, iconUrl }: { id: string; size: number; iconUrl?: string }) {
  const resolvedIconUrl = iconUrl ?? PROVIDER_ICON_URLS[id];
  if (resolvedIconUrl) {
    // Monochrome brand marks: paint with theme text color via CSS mask.
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: "inline-block",
          borderRadius: "var(--radius-xs)",
          backgroundColor: "var(--text-muted)",
          WebkitMaskImage: `url(${resolvedIconUrl})`,
          maskImage: `url(${resolvedIconUrl})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    );
  }
  const pi = PROVIDER_ICONS[id];
  if (!pi) {
    const label = id
      .split(/[-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xs)",
          color: "var(--text-dim)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: Math.max(8, Math.floor(size * 0.42)),
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    );
  }
  // Color icons: self-colored SVG, no wrapper needed
  if (pi.hasColor) return <pi.Icon size={size} />;
  // Mono icons: use currentColor so they adapt to light/dark theme
  return <pi.Icon size={size} style={{ color: "var(--text-muted)" }} />;
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  /** Provider keys already present in models.json (managed free providers hidden when present). */
  existingProviderKeys: string[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onAddFree: (def: FreeProviderDefinition) => void;
  freeBusyId?: FreeProviderId | null;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders, existingProviderKeys,
  onSelectOAuth, onSelectApiKey, onAddCustom, onAddFree, freeBusyId, onClose,
}: AddProviderPickerProps) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();
  const existing = new Set(existingProviderKeys);

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const oauthLoggedInIds = new Set(oauthProviders.filter((p) => p.loggedIn).map((p) => p.id));
  // Hide dual-auth providers from the API Key picker while their OAuth session is active.
  const availableApiKey = apiKeyProviders.filter((p) =>
    !p.configured
    && !oauthLoggedInIds.has(p.id)
    && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  );
  const availableFree = FREE_PROVIDERS.filter((p) => {
    if (existing.has(p.providerKey)) return false;
    if (!q) return true;
    return (
      p.displayName.toLowerCase().includes(q)
      || p.providerKey.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || "free".includes(q)
      || t("models.free").toLowerCase().includes(q)
    );
  });
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + availableFree.length + (showCustom ? 1 : 0);

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 1100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal-shell"
        style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "min(72vh, calc(100vh - 32px))" }}
      >
        {/* Search — borderless strip (avoids a heavy focused frame in the dialog chrome) */}
        <div className="modal-header" style={{ gap: 8, padding: "0 12px" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("models.searchProviders")}
            className="input-base"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              boxShadow: "none",
              paddingLeft: 0,
              paddingRight: 0,
              borderRadius: 0,
            }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div className="modal-empty">{t("models.noProvidersMatch")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {availableFree.length > 0 && (
                <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.free")}</div>
              )}
              {availableFree.map((p) => {
                const busy = freeBusyId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="provider-card"
                    disabled={busy || !!freeBusyId}
                    onClick={() => { onAddFree(p); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.displayName}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                        {busy ? t("models.fetchingFreeModels") : p.description}
                      </div>
                    </div>
                    <ProviderIcon id={p.iconId} size={28} />
                  </button>
                );
              })}

              {showCustom && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableFree.length > 0 ? 6 : 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.custom")}</div>
              )}
              {showCustom && (
                <button
                  type="button"
                  className="provider-card"
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("models.compatible")}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("models.customEndpoint")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)" }}>
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: (showCustom || availableFree.length > 0) ? 6 : 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} type="button" className="provider-card" onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("models.oauth")}</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.apiKey")}</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} type="button" className="provider-card" onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{p.modelCount} models</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({
  onClose,
  onModelsChanged,
  embedded = false,
}: {
  onClose: () => void;
  /** Fired after a successful save so chat pickers can reload. */
  onModelsChanged?: () => void;
  /** When true, render as a full-height settings page panel (no modal chrome). */
  embedded?: boolean;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [freeBusyId, setFreeBusyId] = useState<FreeProviderId | null>(null);
  const [freeRefreshKey, setFreeRefreshKey] = useState<string | null>(null);
  const [freeRefreshError, setFreeRefreshError] = useState<string | null>(null);
  // JSON snapshot of the last loaded/saved config; closing with unsaved
  // edits (config differing from this) asks for confirmation instead of
  // silently discarding them.
  const savedConfigJsonRef = useRef<string>(JSON.stringify({ providers: {} }));

  const mergeFreeModels = useCallback((existing: ModelEntry[] | undefined, fetched: Array<{ id: string; name?: string }>): ModelEntry[] => {
    const prevById = new Map((existing ?? []).map((m) => [m.id, m]));
    return fetched.map((item) => {
      const prev = prevById.get(item.id);
      if (prev) {
        return normalizeModelEntry({
          ...prev,
          id: item.id,
          name: prev.name || item.name || item.id,
        });
      }
      return normalizeModelEntry({
        id: item.id,
        name: item.name || item.id,
        cost: normalizeModelCost(null),
      });
    });
  }, []);

  const fetchFreeModels = useCallback(async (def: FreeProviderDefinition) => {
    const res = await fetch(`/api/models-config/free-models?provider=${encodeURIComponent(def.id)}`);
    const d = await res.json() as {
      models?: Array<{ id: string; name?: string }>;
      error?: string;
    };
    if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
    if (!Array.isArray(d.models) || d.models.length === 0) {
      throw new Error("No free models returned");
    }
    return d.models;
  }, []);

  const addFreeProvider = useCallback(async (def: FreeProviderDefinition) => {
    const existing = config.providers?.[def.providerKey];
    if (existing) {
      if (isFreeManagedProvider(existing)) {
        setSelection({ type: "provider", name: def.providerKey });
        setPickerOpen(false);
        return;
      }
      window.alert(t("models.freeProviderKeyTaken", { key: def.providerKey }));
      return;
    }
    setFreeBusyId(def.id);
    setFreeRefreshError(null);
    try {
      const models = await fetchFreeModels(def);
      const entry: ProviderEntry = {
        managed: def.id,
        baseUrl: def.baseUrl,
        api: def.api,
        apiKey: def.apiKey,
        models: mergeFreeModels(undefined, models),
      };
      setConfig((prev) => ({
        ...prev,
        providers: { ...(prev.providers ?? {}), [def.providerKey]: entry },
      }));
      setSelection({ type: "provider", name: def.providerKey });
      setPickerOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setFreeRefreshError(message);
      // Keep picker open so the user can retry.
      window.alert(message);
    } finally {
      setFreeBusyId(null);
    }
  }, [config.providers, fetchFreeModels, mergeFreeModels, t]);

  const refreshFreeProviderModels = useCallback(async (providerKey: string) => {
    const provider = config.providers?.[providerKey];
    const def = getFreeProvider(typeof provider?.managed === "string" ? provider.managed : undefined);
    if (!provider || !def) return;
    setFreeRefreshKey(providerKey);
    setFreeRefreshError(null);
    try {
      const models = await fetchFreeModels(def);
      setConfig((prev) => {
        const current = prev.providers?.[providerKey];
        if (!current) return prev;
        return {
          ...prev,
          providers: {
            ...(prev.providers ?? {}),
            [providerKey]: {
              ...current,
              managed: def.id,
              baseUrl: def.baseUrl,
              api: def.api,
              apiKey: def.apiKey,
              models: mergeFreeModels(current.models, models),
            },
          },
        };
      });
    } catch (e) {
      setFreeRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setFreeRefreshKey(null);
    }
  }, [config.providers, fetchFreeModels, mergeFreeModels]);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {});
  }, []);

  // Dual-auth providers (e.g. Anthropic) appear in both lists; any auth change
  // must refresh both so the API-key row and OAuth row stay consistent.
  const refreshAuthProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders]);

  useEffect(() => {
    fetch("/api/models-config")
      .then(async (r) => {
        const d = await r.json() as ModelsJson & { error?: string; corrupt?: boolean };
        if (!r.ok) {
          // Corrupt models.json: keep editor empty/read-only of empty defaults but do not
          // mark it as a clean saved baseline the user can casually overwrite.
          setConfig({ providers: {} });
          savedConfigJsonRef.current = "";
          console.error("Failed to load models.json:", d.error ?? r.status);
          return;
        }
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        savedConfigJsonRef.current = JSON.stringify(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch((e) => {
        console.error("Failed to load models.json:", e);
        setConfig({ providers: {} });
        savedConfigJsonRef.current = "";
      })
      .finally(() => setLoading(false));
    refreshAuthProviders();
  }, [refreshAuthProviders]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [
        ...(provider.models ?? []),
        { id: "", cost: normalizeModelCost(null) },
      ];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const addDiscoveredModels = useCallback((providerName: string, models: DiscoveredModel[]) => {
    if (models.length === 0) return;
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const existing = new Set((provider.models ?? []).map((m) => m.id));
      const additions: ModelEntry[] = models
        .filter((m) => m.id && !existing.has(m.id))
        .map((m) => ({
          id: m.id,
          name: m.name,
          cost: normalizeModelCost(null),
        }));
      if (additions.length === 0) return prev;
      return {
        ...prev,
        providers: {
          ...(prev.providers ?? {}),
          [providerName]: {
            ...provider,
            models: [...(provider.models ?? []), ...additions],
          },
        },
      };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    // Normalize every model cost so blank prices become 0 and all four keys exist.
    const providers = { ...(config.providers ?? {}) };
    for (const [name, provider] of Object.entries(providers)) {
      if (!provider?.models?.length) continue;
      providers[name] = {
        ...provider,
        models: provider.models.map((m) => normalizeModelEntry(m)),
      };
    }
    const payload = { ...config, providers };
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else {
        setConfig(payload);
        savedConfigJsonRef.current = JSON.stringify(payload);
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onModelsChanged?.();
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, onModelsChanged]);

  const requestClose = useCallback(() => {
    if (JSON.stringify(config) !== savedConfigJsonRef.current) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [config, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDiscard) { setConfirmDiscard(false); return; }
      if (pickerOpen) { setPickerOpen(false); return; }
      requestClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [confirmDiscard, pickerOpen, requestClose]);

  useEffect(() => {
    setFreeRefreshError(null);
  }, [selection]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  // Dual-auth providers (e.g. kimi-coding) can be OAuth-logged-in and also
  // report as configured — keep a single sidebar row under Subscriptions.
  const activeOAuthIds = new Set(activeOAuth.map((p) => p.id));
  const activeApiKey = apiKeyProviders.filter((p) => p.configured && !activeOAuthIds.has(p.id));

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} onModelsChanged={onModelsChanged} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} onModelsChanged={onModelsChanged} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onAddModels={(models) => addDiscoveredModels(selection.name, models)}
          onRefreshModels={isFreeManagedProvider(provider) ? () => void refreshFreeProviderModels(selection.name) : undefined}
          refreshingModels={freeRefreshKey === selection.name}
          refreshError={freeRefreshError}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
        managed={isFreeManagedProvider(provider)}
      />
    );
  })();

  const panel = (
      <ConfigPanelShell
        embedded={embedded}
        title={t("modal.models")}
        subtitle="~/.pi/agent/models.json"
        onClose={requestClose}
        closeAriaLabel={t("common.close")}
        style={embedded ? undefined : {
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
        }}
      >
        <div className="modal-body" style={{ flexDirection: isMobile ? "column" : "row", flex: 1, minHeight: 0 }}>

          {/* Left: tree */}
          <div className="modal-sidebar" style={isMobile ? { width: "100%", maxHeight: "40vh" } : undefined}>
            <div className="modal-sidebar-scroll">
              {/* Active OAuth subscriptions */}
              {activeOAuth.map((p) => {
                const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                    className={navRowClass(isSelected)}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span className={`modal-nav-label${isSelected ? " is-strong" : ""}`}>{p.name}</span>
                  </div>
                );
              })}

              {/* Active API key providers */}
              {activeApiKey.map((p) => {
                const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                    className={navRowClass(isSelected)}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span className={`modal-nav-label${isSelected ? " is-strong" : ""}`}>{p.displayName}</span>
                  </div>
                );
              })}

              {/* Divider before custom providers, only when there are active managed providers */}
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
              )}

              {/* Custom providers */}
              {loading ? (
                <div style={{ padding: "10px 10px", fontSize: 12, color: "var(--text-muted)" }}>{t("modal.loading")}</div>
              ) : providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                const freeDef = getFreeProvider(typeof pData.managed === "string" ? pData.managed : undefined);
                const managed = !!freeDef;
                const providerLabel = freeDef?.displayName ?? pName;
                return (
                  <div key={pName}>
                    {/* Provider row */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      className={navRowClass(isProviderSelected)}
                    >
                      {managed ? (
                        <ProviderIcon id={freeDef.iconId} size={14} />
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                          <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                          <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                          <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                          <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                          <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                        </svg>
                      )}
                      <span className={`modal-nav-label${managed ? "" : " is-mono"}${isProviderSelected ? " is-strong" : ""}`}>{providerLabel}</span>
                      {managed && (
                        <span className="settings-badge" style={{ flexShrink: 0 }}>{t("models.free")}</span>
                      )}
                    </div>

                    {/* Model rows */}
                    {models.map((m, i) => {
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      return (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                          className={navRowClass(isModelSelected, true)}
                          style={m.disabled ? { opacity: 0.55 } : undefined}
                        >
                          <span className="modal-nav-label is-mono" style={{ color: m.id ? undefined : "var(--text-dim)" }}>
                            {m.id || t("models.newModel")}
                          </span>
                          {m.disabled && (
                            <span className="settings-badge" style={{ flexShrink: 0 }}>{t("models.disabled")}</span>
                          )}
                          {m.reasoning && (
                            <span style={{ fontSize: 9, padding: "1px 5px", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: "var(--radius-xs)", flexShrink: 0 }}>T</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Add model button — not for free/managed providers */}
                    {!managed && (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                        className={navRowClass(false, true)}
                      >
                        <span className="modal-nav-label">{t("models.addModel")}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add provider — strip footer action */}
            <div className="modal-sidebar-footer">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="chrome-btn"
              >
                {t("modal.addProvider")}
              </button>
            </div>
          </div>

          {/* Right: detail */}
          <div className="modal-main">
            {loading ? null : detailContent ?? (
              <div className="modal-empty">{t("models.selectHint")}</div>
            )}
          </div>
        </div>

        {/* Footer — strip chrome */}
        <div className="modal-footer" style={embedded ? { borderRadius: 0 } : undefined}>
          {saveError && <span style={{ fontSize: 12, color: "var(--destructive)", flex: 1, minWidth: 0 }}>{saveError}</span>}
          {!embedded && (
            <button type="button" onClick={requestClose} className="chrome-btn">
              {t("common.cancel")}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || savedOk}
            style={{
              minWidth: 88,
              background: savedOk ? "var(--success)" : undefined,
              animation: savedOk ? "saved-pop 0.45s ease" : undefined,
            }}
          >
            {savedOk && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span>{savedOk ? t("common.saved") : saving ? t("common.saving") : t("common.save")}</span>
          </button>
        </div>
      </ConfigPanelShell>
  );

  return (
    <>
    {embedded ? panel : (
      <ConfigPanelBackdrop onClose={requestClose}>
        {panel}
      </ConfigPanelBackdrop>
    )}
    {confirmDiscard && (
      <div
        className="modal-backdrop"
        style={{ zIndex: 1100 }}
        onClick={(e) => { if (e.target === e.currentTarget) setConfirmDiscard(false); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="modal-shell"
          style={{ width: "min(360px, calc(100vw - 32px))" }}
        >
          <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            {t("models.unsavedChanges")}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={() => setConfirmDiscard(false)} className="chrome-btn">{t("common.cancel")}</button>
            <button type="button" onClick={() => { setConfirmDiscard(false); onClose(); }} className="btn-danger">{t("models.discardChanges")}</button>
          </div>
        </div>
      </div>
    )}
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        existingProviderKeys={Object.keys(config.providers ?? {})}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onAddCustom={addCustomProvider}
        onAddFree={(def) => void addFreeProvider(def)}
        freeBusyId={freeBusyId}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
