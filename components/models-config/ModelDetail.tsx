"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { Icon } from "../Icon";
import { Check as CheckIcon } from "lucide-react";
import { DEEPSEEK_COMPAT } from "@/lib/deepseek-compat";
import {
  Field, TextInput, NumInput, Select, Check, SectionTitle, DetailStrip, ReadOnlyValue,
} from "./form-fields";
import {
  API_OPTIONS,
  LEVEL_COLORS,
  THINKING_LEVELS,
  type ModelEntry,
  type ModelTestState,
  type ProviderEntry,
  type ThinkingLevel,
} from "./models-config-types";
import { apiFetch } from "@/lib/api-transport";

export function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useLocale();
  const map = value ?? {};
  const [customLevel, setCustomLevel] = useState<ThinkingLevel | null>(null);
  const customInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => {
    setCustomLevel(null);
  }, [value]);
  const focusCustomInput = (level: ThinkingLevel) => {
    setCustomLevel(level);
    const input = customInputRefs.current[level];
    input?.focus();
    input?.select();
  };

  const setLevel = (level: ThinkingLevel, entry: string | null | "default") => {
    const next = { ...map };
    if (entry === "default") {
      // Include level in user budget with standard API name.
      next[level] = level;
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const inMap = level in map;
        const baseState: "unset" | "default" | "null" | "string" =
          !inMap ? "unset" : raw === null ? "null" : raw === level ? "default" : "string";
        const state: "unset" | "default" | "null" | "string" =
          customLevel === level && baseState !== "string" ? "string" : baseState;
        const strVal = state === "string" && typeof raw === "string" && baseState === "string" ? raw : "";
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
              opacity: state === "unset" ? 0.75 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" || state === "unset" ? 0.3 : 1 }} />
              <span style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: state === "null" || state === "unset" ? "var(--text-dim)" : "var(--text-muted)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>

            <div className="settings-segmented" style={{ minWidth: 0, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setLevel(level, "default")}
                className={`chrome-btn${state === "default" ? " is-active" : ""}`}
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

            <div className="settings-segmented" style={{ minWidth: 0 }}>
              <button
                type="button"
                onClick={() => focusCustomInput(level)}
                className={`chrome-btn${state === "string" ? " is-active" : ""}`}
                style={{ flexShrink: 0 }}
              >
                {t("models.custom")}
              </button>
              <input
                ref={(input) => { customInputRefs.current[level] = input; }}
                value={state === "string" ? strVal : (state === "default" ? level : "")}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: "transparent",
                  border: "none",
                  color: state === "string" || state === "default" ? "var(--text)" : "var(--text-dim)",
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
export function ThinkingMapSummary({ map }: { map: Record<string, string | null> | undefined }) {
  const { t } = useLocale();
  return (
    <div>
      <SectionTitle>{t("models.thinkingMap")}</SectionTitle>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        {map
          ? Object.entries(map).map(([k, v]) => (
              <div key={k} style={{ padding: "3px 0" }}>{k}: {v === null ? "—" : v}</div>
            ))
          : "—"}
      </div>
    </div>
  );
}


// ── Model detail ──────────────────────────────────────────────────────────────


export function seedThinkingBudgetMap(): Record<string, string | null> {
  const seed: Record<string, string | null> = {};
  for (const level of THINKING_LEVELS) seed[level] = level;
  return seed;
}

/** Official map = read-only; otherwise a toggle to enable custom thinking budget + editor. */
function ThinkingBudgetControls({
  editable,
  map,
  onChangeMap,
  deepseek,
}: {
  editable: boolean;
  map: Record<string, string | null> | undefined;
  onChangeMap: (v: Record<string, string | null> | undefined) => void;
  deepseek?: { checked: boolean; onChange: (v: boolean) => void };
}) {
  const { t } = useLocale();
  const budgetOn = !!map && Object.keys(map).length > 0;

  if (!editable) {
    return <ThinkingMapSummary map={map} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {deepseek && (
        <Check
          label={t("models.deepseekCompat")}
          checked={deepseek.checked}
          onChange={deepseek.onChange}
        />
      )}
      <Check
        label={t("models.thinkingBudget")}
        checked={budgetOn}
        onChange={(on) => onChangeMap(on ? seedThinkingBudgetMap() : undefined)}
      />
      {budgetOn && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <SectionTitle>{t("models.thinkingMap")}</SectionTitle>
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={() => onChangeMap(undefined)}
            >
              {t("models.clearAll")}
            </button>
          </div>
          <ThinkingLevelMapEditor value={map} onChange={onChangeMap} />
        </div>
      )}
    </div>
  );
}

export { DEEPSEEK_COMPAT };

export function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
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

  const officialLocked = managed;
  // Custom models: always editable. Managed free: toggle-only (officialLocked).
  const thinkingMapEditable = !officialLocked;
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
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

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await apiFetch("/api/models-config/test", {
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


  return (
    <div>
      <DetailStrip
        title={t("models.model")}
        actions={(
          <>
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

      {model.disabled && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            margin: "0 0 10px",
          }}
        >
          {t("models.disabledNotice")}
        </div>
      )}

      <div className="settings-group">
        <div className="settings-card">
          <Field label={t("models.idRequired")}>
            {managed ? (
              <ReadOnlyValue mono>{model.id}</ReadOnlyValue>
            ) : (
              <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono />
            )}
          </Field>
          <Field label={t("shell.name")}>
            {officialLocked ? (
              <ReadOnlyValue>{model.name?.trim() || model.id || "—"}</ReadOnlyValue>
            ) : (
              <TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("models.displayName")} />
            )}
          </Field>

          {/* Free managed: only official summary. Catalog-locked + editable share the rest. */}
          {managed ? (
            <>
              <div className="settings-row">
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                  <span>{t("models.reasoning")}: <strong style={{ color: "var(--text)", fontWeight: 600 }}>{model.reasoning ? "✓" : "—"}</strong></span>
                  <span>{t("models.imageInput")}: <strong style={{ color: "var(--text)", fontWeight: 600 }}>{model.input?.includes("image") ? "✓" : "—"}</strong></span>
                </div>
              </div>
              <Field label={t("models.contextWindow")}>
                <ReadOnlyValue mono>{model.contextWindow !== undefined ? String(model.contextWindow) : "—"}</ReadOnlyValue>
              </Field>
              <Field label={t("models.maxOutput")}>
                <ReadOnlyValue mono>{model.maxTokens !== undefined ? String(model.maxTokens) : "—"}</ReadOnlyValue>
              </Field>
              {model.reasoning && (
                <div className="settings-row is-stacked">
                  <ThinkingBudgetControls
                    editable={thinkingMapEditable}
                    map={model.thinkingLevelMap}
                    onChangeMap={(v) => {
                      if (!v) onChange({ ...model, thinkingLevelMap: undefined });
                      else set("thinkingLevelMap", v);
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <Field label={t("models.apiOverride")}>
                <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
              </Field>

              <div className="settings-row">
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {officialLocked ? (
                    <>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {t("models.reasoning")}: <strong style={{ color: "var(--text)", fontWeight: 600 }}>{model.reasoning ? "✓" : "—"}</strong>
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {t("models.imageInput")}: <strong style={{ color: "var(--text)", fontWeight: 600 }}>{model.input?.includes("image") ? "✓" : "—"}</strong>
                      </span>
                    </>
                  ) : (
                    <>
                      <Check label={t("models.reasoning")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
                      <Check label={t("models.imageInput")} checked={model.input?.includes("image") ?? false}
                        onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
                    </>
                  )}
                </div>
              </div>

              {model.reasoning && (
                <div className="settings-row is-stacked">
                  <ThinkingBudgetControls
                    editable={thinkingMapEditable}
                    map={model.thinkingLevelMap}
                    onChangeMap={(v) => {
                      if (!v) onChange({ ...model, thinkingLevelMap: undefined });
                      else set("thinkingLevelMap", v);
                    }}
                    deepseek={{
                      checked: hasDeepseekCompat(model),
                      onChange: (v) => onChange(setDeepseekCompat(model, v)),
                    }}
                  />
                </div>
              )}

              <Field label={t("models.contextWindow")}>
                {officialLocked && model.contextWindow !== undefined ? (
                  <ReadOnlyValue mono>{String(model.contextWindow)}</ReadOnlyValue>
                ) : (
                  <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
                    onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
                )}
              </Field>
              <Field label={t("models.maxOutput")}>
                {officialLocked && model.maxTokens !== undefined ? (
                  <ReadOnlyValue mono>{String(model.maxTokens)}</ReadOnlyValue>
                ) : (
                  <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
                    onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
                )}
              </Field>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
