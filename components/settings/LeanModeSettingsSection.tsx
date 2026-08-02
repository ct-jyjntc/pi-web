"use client";

/**
 * Settings UI for opt-in Lean Mode (anti-bloat policy + optional review).
 */
import { useCallback, useEffect, useState } from "react";
import { SettingsToggle } from "@/components/SettingsToggle";
import type { MessageKey } from "@/lib/i18n/messages";
import type { LeanIntensity, LeanModeSettings } from "@/lib/lean-mode-settings";

type Translate = (key: MessageKey) => string;

export function LeanModeSettingsSection({
  leanMode,
  onPatch,
  t,
  cwd,
}: {
  leanMode: LeanModeSettings;
  onPatch: (next: Partial<LeanModeSettings>) => void;
  t: Translate;
  /** Current project cwd for per-project override (optional). */
  cwd?: string | null;
}) {
  const disabledExtras = !leanMode.enabled;
  const [projectEnabled, setProjectEnabled] = useState<boolean | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectNote, setProjectNote] = useState<string | null>(null);

  const loadProject = useCallback(() => {
    if (!cwd) {
      setProjectEnabled(null);
      return;
    }
    void fetch(`/api/lean-project?cwd=${encodeURIComponent(cwd)}`)
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json() as { override?: { enabled?: boolean } | null };
        if (data.override && typeof data.override.enabled === "boolean") {
          setProjectEnabled(data.override.enabled);
        } else {
          setProjectEnabled(null);
        }
      })
      .catch(() => setProjectEnabled(null));
  }, [cwd]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  return (
    <>
      <div className="settings-section-title">{t("settings.leanSection")}</div>

      <div className="settings-row">
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="settings-row-title">{t("settings.leanMode")}</div>
          <div className="settings-row-desc">{t("settings.leanModeDesc")}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <SettingsToggle
            enabled={leanMode.enabled}
            onChange={(next) => onPatch({ enabled: next })}
          />
        </div>
      </div>

      <div className="settings-row is-stacked">
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="settings-row-title">{t("settings.leanIntensity")}</div>
          <div className="settings-row-desc">{t("settings.leanIntensityDesc")}</div>
        </div>
        <div style={{ flexShrink: 0, width: "100%" }}>
          <select
            className="input-base"
            value={leanMode.intensity}
            disabled={disabledExtras}
            aria-label={t("settings.leanIntensity")}
            onChange={(e) => onPatch({ intensity: e.target.value as LeanIntensity })}
            style={{ width: "100%", maxWidth: 280 }}
          >
            <option value="soft">{t("settings.leanIntensitySoft")}</option>
            <option value="review">{t("settings.leanIntensityReview")}</option>
            <option value="hard">{t("settings.leanIntensityHard")}</option>
          </select>
        </div>
      </div>

      <div className="settings-row">
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="settings-row-title">{t("settings.leanReviewOnEnd")}</div>
          <div className="settings-row-desc">{t("settings.leanReviewOnEndDesc")}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <SettingsToggle
            enabled={leanMode.reviewOnAgentEnd}
            disabled={disabledExtras || leanMode.intensity === "soft"}
            onChange={(next) => onPatch({ reviewOnAgentEnd: next })}
          />
        </div>
      </div>

      {leanMode.intensity === "hard" && leanMode.enabled ? (
        <div className="settings-row is-stacked">
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="settings-row-title">{t("settings.leanHardGates")}</div>
            <div className="settings-row-desc">{t("settings.leanHardGatesDesc")}</div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", width: "100%" }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("settings.leanLargeFileLines")}
              <input
                className="input-base"
                type="number"
                min={100}
                max={50000}
                value={leanMode.hardGates.largeFileLineThreshold}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onPatch({
                    hardGates: {
                      ...leanMode.hardGates,
                      largeFileLineThreshold: n,
                    },
                  });
                }}
                style={{ width: 96, marginLeft: 8 }}
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("settings.leanMaxNetGrowth")}
              <input
                className="input-base"
                type="number"
                min={0}
                max={5000}
                value={leanMode.hardGates.maxNetGrowthOnLargeFile}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onPatch({
                    hardGates: {
                      ...leanMode.hardGates,
                      maxNetGrowthOnLargeFile: n,
                    },
                  });
                }}
                style={{ width: 96, marginLeft: 8 }}
              />
            </label>
          </div>
        </div>
      ) : null}

      <div className="settings-row-desc" style={{ margin: "4px 0 12px", color: "var(--text-dim)" }}>
        {t("settings.leanSessionReloadNote")}
      </div>

      {cwd ? (
        <>
          <div className="settings-row">
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div className="settings-row-title">{t("settings.leanProjectOverride")}</div>
              <div className="settings-row-desc">{t("settings.leanProjectOverrideDesc")}</div>
            </div>
            <div style={{ flexShrink: 0, display: "flex", gap: 8, alignItems: "center" }}>
              <SettingsToggle
                enabled={projectEnabled === true}
                loading={projectBusy}
                onChange={(next) => {
                  setProjectBusy(true);
                  setProjectNote(null);
                  void fetch("/api/lean-project", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      cwd,
                      leanMode: { enabled: next },
                    }),
                  })
                    .then(async (r) => {
                      const data = await r.json() as { note?: string; error?: string };
                      if (!r.ok) throw new Error(data.error || "failed");
                      setProjectEnabled(next);
                      setProjectNote(data.note ?? t("settings.leanProjectSaved"));
                    })
                    .catch((e) => setProjectNote(e instanceof Error ? e.message : String(e)))
                    .finally(() => setProjectBusy(false));
                }}
              />
              {projectEnabled !== null ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={projectBusy}
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => {
                    setProjectBusy(true);
                    setProjectNote(null);
                    void fetch("/api/lean-project", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cwd, clear: true }),
                    })
                      .then(async (r) => {
                        if (!r.ok) throw new Error("clear failed");
                        setProjectEnabled(null);
                        setProjectNote(t("settings.leanProjectCleared"));
                      })
                      .catch((e) => setProjectNote(e instanceof Error ? e.message : String(e)))
                      .finally(() => setProjectBusy(false));
                  }}
                >
                  {t("settings.leanProjectClear")}
                </button>
              ) : null}
            </div>
          </div>
          {projectNote ? (
            <div className="settings-row-desc" style={{ marginBottom: 8, color: "var(--text-muted)" }}>
              {projectNote}
            </div>
          ) : null}
        </>
      ) : (
        <div className="settings-row-desc" style={{ marginBottom: 8, color: "var(--text-dim)" }}>
          {t("settings.leanProjectNeedCwd")}
        </div>
      )}
    </>
  );
}
