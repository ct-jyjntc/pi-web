"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { Icon } from "../Icon";
import { Check as CheckIcon } from "lucide-react";
import { normalizeModelCost, type ModelCost } from "@/lib/model-cost";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import {
  Field, TextInput, NumInput, Select, Check, SectionTitle, DetailStrip,
} from "./form-fields";
import {
  API_OPTIONS,
  LEVEL_COLORS,
  THINKING_LEVELS,
  type ModelCatalogState,
  type ModelEntry,
  type ModelTestState,
  type ProviderEntry,
  type ThinkingLevel,
} from "./models-config-types";

export function ThinkingLevelMapEditor({
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

export const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

export function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

export function fillEmptyModelFields(
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

export function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

export function ModelDetail({
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
    const next = normalizeModelCost({ ...(model.cost ?? {}), [k]: v.trim() === "" ? 0 : v });
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
              <Icon icon={CheckIcon} size={11} strokeWidth={3} />
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


