"use client";

/* Prefs/report shapes are owned by SettingsPage; keep panel props loose. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, type ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import { SettingsGroup, SettingsRow } from "./settings-ui";
import { apiFetch } from "@/lib/api-transport";
import { invalidateProjectMemory, useProjectMemoryFacts } from "@/lib/project-memory-store";

export type MemorySettingsPanelProps = {
  prefs: any;
  setPrefs: (value: any | ((prev: any) => any)) => void;
  patchPref: (patch: Record<string, unknown>) => void | Promise<void>;
  cwd: string | null;
  setSaveError: (v: string | null) => void;
  saveErrorBlock: ReactNode;
};

export function MemorySettingsPanel(props: MemorySettingsPanelProps) {
  const { t } = useLocale();
  const { prefs, setPrefs, patchPref, cwd, setSaveError, saveErrorBlock } = props;
  const memoryFacts = useProjectMemoryFacts(cwd);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryReflectBusy, setMemoryReflectBusy] = useState(false);
  const [memoryReflectText, setMemoryReflectText] = useState<string | null>(null);
  const [memoryReflectMeta, setMemoryReflectMeta] = useState<string | null>(null);

  return (
    <>
      <SettingsGroup title={t("settings.memory")}>

      <SettingsRow
        title={t("settings.projectMemory")}
        description={t("settings.projectMemoryDesc")}
        action={
          <SettingsToggle
            enabled={prefs.projectMemoryEnabled}
            onChange={(next) => {
              setPrefs((p: any) => ({
                ...p,
                projectMemoryEnabled: next,
                // Turning tools off also turns inject off.
                projectMemoryAutoInject: next ? p.projectMemoryAutoInject : false,
              }));
              void patchPref({
                projectMemory: next
                  ? { enabled: true }
                  : { enabled: false, autoInject: false },
              });
            }}
          />
        }
      />
      <SettingsRow
        title={t("settings.projectMemoryAutoInject")}
        description={t("settings.projectMemoryAutoInjectDesc")}
        action={
          <SettingsToggle
            enabled={prefs.projectMemoryAutoInject}
            disabled={!prefs.projectMemoryEnabled}
            onChange={(next) => {
              setPrefs((p: any) => ({ ...p, projectMemoryAutoInject: next }));
              void patchPref({ projectMemory: { autoInject: next } });
            }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.projectMemoryTopK")}
        description={t("settings.projectMemoryTopKDesc")}
        action={
          <input
            className="input-base input-mono"
            type="number"
            min={0}
            max={50}
            value={prefs.projectMemoryTopK}
            disabled={!prefs.projectMemoryEnabled || !prefs.projectMemoryAutoInject}
            onChange={(e) => setPrefs((p: any) => ({
              ...p,
              projectMemoryTopK: Number(e.target.value) || 0,
            }))}
            onBlur={() => void patchPref({
              projectMemory: { autoInjectTopK: prefs.projectMemoryTopK },
            })}
            style={{ width: 100 }}
          />
        }
      />
      </SettingsGroup>

      {!cwd && (
        <div className="settings-row-desc" style={{ marginTop: 4, marginBottom: 8 }}>
          {t("settings.projectMemoryNeedCwd")}
        </div>
      )}

      {cwd && prefs.projectMemoryEnabled && (
        <>
          <SettingsGroup title={t("settings.projectMemoryFacts")}>
            {memoryFacts.length === 0 ? (
              <div className="settings-card-empty">{t("settings.projectMemoryEmpty")}</div>
            ) : (
              memoryFacts.map((f) => (
                <SettingsRow
                  key={f.id}
                  title={f.text}
                  action={
                    <button
                      type="button"
                      className="btn-ghost btn-compact"
                      disabled={memoryBusy}
                      onClick={() => {
                        setMemoryBusy(true);
                        void apiFetch("/api/project-memory", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ cwd, id: f.id }),
                        })
                          .then(async (res) => {
                            const data = await res.json() as { error?: string };
                            if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                            invalidateProjectMemory();
                          })
                          .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                          .finally(() => setMemoryBusy(false));
                      }}
                    >
                      {t("settings.projectMemoryDelete")}
                    </button>
                  }
                />
              ))
            )}
            <div className="settings-card-footer">
              <input
                className="input-base"
                value={newMemoryText}
                onChange={(e) => setNewMemoryText(e.target.value)}
                placeholder={t("settings.projectMemoryAdd")}
              />
              <button
                type="button"
                className="btn-primary btn-compact"
                disabled={memoryBusy || !newMemoryText.trim()}
                onClick={() => {
                  setMemoryBusy(true);
                  void apiFetch("/api/project-memory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ cwd, text: newMemoryText.trim() }),
                  })
                    .then(async (res) => {
                      const data = await res.json() as { fact?: { id: string; text: string }; error?: string };
                      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                      invalidateProjectMemory();
                      setNewMemoryText("");
                    })
                    .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setMemoryBusy(false));
                }}
              >
                {t("settings.projectMemoryAdd")}
              </button>
            </div>
          </SettingsGroup>

          <SettingsGroup title={t("settings.projectMemoryReflect")}>
            <div className="settings-card-footer" style={{ borderTop: "none", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-ghost btn-compact"
                disabled={memoryReflectBusy || memoryBusy || memoryFacts.length === 0}
                title={t("settings.projectMemoryReflectDesc")}
                onClick={() => {
                  setMemoryReflectBusy(true);
                  setMemoryReflectText(null);
                  setMemoryReflectMeta(null);
                  void apiFetch("/api/project-memory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ cwd, action: "reflect", useModel: true, limit: 40 }),
                  })
                    .then(async (res) => {
                      const data = await res.json() as {
                        reflection?: { summary?: string; mode?: string; factCount?: number; model?: string };
                        error?: string;
                      };
                      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                      const r = data.reflection;
                      setMemoryReflectText(r?.summary ?? "");
                      setMemoryReflectMeta(
                        r
                          ? `${r.mode ?? "?"} · ${r.factCount ?? 0} facts${r.model ? ` · ${r.model}` : ""}`
                          : null,
                      );
                    })
                    .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setMemoryReflectBusy(false));
                }}
              >
                {memoryReflectBusy ? t("settings.projectMemoryReflecting") : t("settings.projectMemoryReflect")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-compact"
                disabled={memoryReflectBusy || memoryBusy || memoryFacts.length === 0}
                onClick={() => {
                  setMemoryReflectBusy(true);
                  setMemoryReflectText(null);
                  setMemoryReflectMeta(null);
                  void apiFetch("/api/project-memory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ cwd, action: "reflect", heuristicOnly: true, limit: 40 }),
                  })
                    .then(async (res) => {
                      const data = await res.json() as {
                        reflection?: { summary?: string; mode?: string; factCount?: number };
                        error?: string;
                      };
                      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                      const r = data.reflection;
                      setMemoryReflectText(r?.summary ?? "");
                      setMemoryReflectMeta(r ? `${r.mode ?? "heuristic"} · ${r.factCount ?? 0} facts` : null);
                    })
                    .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setMemoryReflectBusy(false));
                }}
              >
                {t("settings.projectMemoryReflectFast")}
              </button>
            </div>
            {memoryReflectText && (
              <div className="settings-row is-stacked">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {memoryReflectMeta && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                      {memoryReflectMeta}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    disabled={memoryBusy || memoryReflectBusy || !memoryReflectText.trim()}
                    style={{ marginLeft: "auto" }}
                    title={t("settings.projectMemoryRetainReflectDesc")}
                    onClick={() => {
                      const lines = memoryReflectText
                        .split("\n")
                        .map((l) => l.trim())
                        .filter((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("mode:") && !l.startsWith("facts"));
                      const pick = lines.find((l) => l.startsWith("-") || l.match(/^\d+\./)) ?? lines[0] ?? "";
                      const text = pick.replace(/^[-*\d.\s]+/, "").trim().slice(0, 360);
                      if (!text) return;
                      setMemoryBusy(true);
                      void apiFetch("/api/project-memory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          cwd,
                          text: `Reflect: ${text}`,
                          tags: ["reflect"],
                          importance: 0.7,
                        }),
                      })
                        .then(async (res) => {
                          const data = await res.json() as { error?: string };
                          if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                          invalidateProjectMemory();
                        })
                        .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                        .finally(() => setMemoryBusy(false));
                    }}
                  >
                    {t("settings.projectMemoryRetainReflect")}
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {memoryReflectText}
                </pre>
              </div>
            )}
          </SettingsGroup>
        </>
      )}

      {saveErrorBlock}
    </>

  );
}
