"use client";

/**
 * Detail panel for built-in (API-key / OAuth) catalog models.
 * Official metadata is read-only when present; missing fields (esp. thinking map) are user-editable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { Field, NumInput, SectionTitle, DetailStrip, Check, ReadOnlyValue } from "./form-fields";
import { seedThinkingBudgetMap, ThinkingLevelMapEditor, ThinkingMapSummary } from "./ModelDetail";
import type { ProviderModelRow } from "./models-config-types";

export function BuiltinModelDetail({
  model,
  onModelPatch,
}: {
  model: ProviderModelRow;
  onModelPatch: (patch: Partial<ProviderModelRow>) => Promise<void>;
}) {
  const { t } = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local drafts keep unknown numeric fields editable until the user commits them.
  const [contextDraft, setContextDraft] = useState(() => model.contextWindow !== undefined ? String(model.contextWindow) : "");
  const [maxTokensDraft, setMaxTokensDraft] = useState(() => model.maxTokens !== undefined ? String(model.maxTokens) : "");
  // Local map avoids race when rapidly editing levels before parent re-renders.
  const [localMap, setLocalMap] = useState(model.thinkingLevelMap);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalMap(model.thinkingLevelMap);
    setContextDraft(model.contextWindow !== undefined ? String(model.contextWindow) : "");
    setMaxTokensDraft(model.maxTokens !== undefined ? String(model.maxTokens) : "");
  }, [model.id, model.thinkingLevelMap, model.contextWindow, model.maxTokens]);

  useEffect(() => () => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
  }, []);


  const savePatch = useCallback(async (patch: Partial<ProviderModelRow>) => {
    setSaving(true);
    setError(null);
    try {
      await onModelPatch(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [onModelPatch]);
  const saveNumber = useCallback((field: "contextWindow" | "maxTokens", value: string) => {
    const n = Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return;
    void savePatch(field === "contextWindow" ? { contextWindow: n } : { maxTokens: n });
  }, [savePatch]);

  const onMapChange = useCallback((v: Record<string, string | null> | undefined) => {
    setLocalMap(v);
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void savePatch({ thinkingLevelMap: v && Object.keys(v).length ? v : {} });
    }, 280);
  }, [savePatch]);


  return (
    <div>
      <DetailStrip title={t("models.model")} />

      {error && (
        <div style={{ fontSize: 12, color: "var(--destructive)", margin: "0 0 8px" }}>{error}</div>
      )}

      <div className="settings-group">
        <div className="settings-card">
          <Field label={t("models.idRequired")}>
            <ReadOnlyValue mono>{model.id}</ReadOnlyValue>
          </Field>
          <Field label={t("shell.name")}>
            <ReadOnlyValue>{model.name || model.id}</ReadOnlyValue>
          </Field>

          <div className="settings-row">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {model.reasoningEditable === false ? (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("models.reasoning")}: <strong style={{ color: "var(--text)", fontWeight: 600 }}>{model.reasoning ? "✓" : "—"}</strong>
                </span>
              ) : (
                <Check
                  label={t("models.reasoning")}
                  checked={model.reasoning}
                  onChange={(v) => void savePatch({ reasoning: v })}
                />
              )}
              <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                {t("models.imageInput")}: {""}
                <strong style={{ color: "var(--text)", fontWeight: 600 }}>{model.supportsImage ? "✓" : "—"}</strong>
              </span>
            </div>
          </div>

          {model.reasoning && (
            <div className="settings-row is-stacked">
              {model.thinkingMapEditable === false ? (
                <ThinkingMapSummary map={model.thinkingLevelMap} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Check
                    label={t("models.thinkingBudget")}
                    checked={!!localMap && Object.keys(localMap).length > 0}
                    onChange={(on) => {
                      if (!on) {
                        onMapChange(undefined);
                        return;
                      }
                      onMapChange(seedThinkingBudgetMap());
                    }}
                  />
                  {localMap && Object.keys(localMap).length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <SectionTitle>{t("models.thinkingMap")}</SectionTitle>
                        <button
                          type="button"
                          className="btn-ghost btn-compact"
                          disabled={saving}
                          onClick={() => onMapChange(undefined)}
                        >
                          {t("models.clearAll")}
                        </button>
                      </div>
                      <ThinkingLevelMapEditor
                        value={localMap}
                        onChange={onMapChange}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Field label={t("models.contextWindow")}>
            {model.contextWindowEditable !== false ? (
              <NumInput
                value={contextDraft}
                onChange={setContextDraft}
                onBlur={() => saveNumber("contextWindow", contextDraft)}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                placeholder="128000"
              />
            ) : (
              <ReadOnlyValue mono>{model.contextWindow !== undefined ? String(model.contextWindow) : "—"}</ReadOnlyValue>
            )}
          </Field>
          <Field label={t("models.maxOutput")}>
            {model.maxTokensEditable !== false ? (
              <NumInput
                value={maxTokensDraft}
                onChange={setMaxTokensDraft}
                onBlur={() => saveNumber("maxTokens", maxTokensDraft)}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                placeholder="16384"
              />
            ) : (
              <ReadOnlyValue mono>{model.maxTokens !== undefined ? String(model.maxTokens) : "—"}</ReadOnlyValue>
            )}
          </Field>
        </div>
      </div>
    </div>
  );
}
