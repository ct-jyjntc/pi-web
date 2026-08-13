/**
 * Settings → Permissions: table editor for allow/ask/deny rules + advanced JSON.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  COMMON_SURFACES,
  PERMISSION_ACTIONS,
  emptyRuleRow,
  permissionToRows,
  rowsToPermission,
  validatePermissionRows,
  type PermissionRuleRow,
} from "@/lib/permission-policy-rows";
import type { PermissionAction } from "@/lib/permission-policy";
import { Icon } from "../Icon";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "./settings-ui";
import { SettingsToggle } from "../SettingsToggle";
import { apiFetch } from "@/lib/api-transport";

type PolicyDoc = {
  yoloMode?: boolean;
  permission?: Record<string, unknown>;
  [key: string]: unknown;
};

type EditorMode = "table" | "json";

export function PermissionsSettingsPanel() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [policyPath, setPolicyPath] = useState("");
  const [policyExists, setPolicyExists] = useState(false);
  const [yoloMode, setYoloMode] = useState(false);
  const [rows, setRows] = useState<PermissionRuleRow[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [mode, setMode] = useState<EditorMode>("table");
  const [dirty, setDirty] = useState(false);

  const applyPermissionObject = useCallback((permission: unknown) => {
    const obj = permission && typeof permission === "object" && !Array.isArray(permission)
      ? (permission as Record<string, never>)
      : {};
    const nextRows = permissionToRows(obj);
    setRows(nextRows);
    setJsonText(JSON.stringify(obj, null, 2));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/permissions");
      const data = await res.json() as {
        error?: string;
        yoloMode?: boolean;
        policyPath?: string;
        policyExists?: boolean;
        policy?: PolicyDoc;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setYoloMode(data.yoloMode === true);
      setPolicyPath(data.policyPath ?? "");
      setPolicyExists(data.policyExists === true);
      applyPermissionObject(data.policy?.permission ?? {});
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyPermissionObject]);

  useEffect(() => {
    void load();
  }, [load]);

  const permissionFromEditor = useCallback((): Record<string, unknown> => {
    if (mode === "json") {
      const parsed = JSON.parse(jsonText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("settings.permInvalidJson"));
      }
      return parsed as Record<string, unknown>;
    }
    const err = validatePermissionRows(rows);
    if (err) throw new Error(t("settings.permRowsInvalid"));
    return rowsToPermission(rows) as Record<string, unknown>;
  }, [jsonText, mode, rows, t]);

  const switchMode = useCallback((next: EditorMode) => {
    if (next === mode) return;
    try {
      if (next === "json") {
        setJsonText(JSON.stringify(rowsToPermission(rows), null, 2));
      } else {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("settings.permInvalidJson"));
        }
        setRows(permissionToRows(parsed as Record<string, never>));
      }
      setMode(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [jsonText, mode, rows, t]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const permission = permissionFromEditor();
      const res = await apiFetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-policy",
          policy: {
            yoloMode,
            permissionReviewLog: true,
            permission,
          },
        }),
      });
      const data = await res.json() as { error?: string; policy?: PolicyDoc; policyPath?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPolicyExists(true);
      if (data.policyPath) setPolicyPath(data.policyPath);
      applyPermissionObject(data.policy?.permission ?? permission);
      setDirty(false);
      setNotice(t("settings.permSaved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [applyPermissionObject, permissionFromEditor, t, yoloMode]);

  const resetDefaults = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-defaults" }),
      });
      const data = await res.json() as {
        error?: string;
        policy?: PolicyDoc;
        yoloMode?: boolean;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setYoloMode(data.yoloMode === true || data.policy?.yoloMode === true);
      applyPermissionObject(data.policy?.permission ?? {});
      setPolicyExists(true);
      setDirty(false);
      setNotice(t("settings.permReset"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [applyPermissionObject, t]);

  const toggleYolo = useCallback(async (next: boolean) => {
    setYoloMode(next);
    setError(null);
    try {
      const res = await apiFetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next ? "full" : "ask" }),
      });
      const data = await res.json() as { error?: string; yoloMode?: boolean };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setYoloMode(data.yoloMode === true);
      setNotice(t("settings.permYoloUpdated"));
    } catch (e) {
      setYoloMode(!next);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  const updateRow = useCallback((id: string, patch: Partial<PermissionRuleRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
    setNotice(null);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
    setNotice(null);
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRuleRow()]);
    setDirty(true);
    setNotice(null);
  }, []);

  return (
    <div className="settings-page-general">
      <SettingsPageHeading title={t("settings.permissions")} description={t("settings.permissionsDesc")} />

      {loading ? (
        <div className="settings-card-empty">{t("common.loading")}</div>
      ) : (
        <>
          <SettingsGroup>
            <SettingsRow
              title={t("settings.permYolo")}
              description={t("settings.permYoloHint")}
              action={
                <SettingsToggle
                  enabled={yoloMode}
                  onChange={(next) => void toggleYolo(next)}
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup
            title={t("settings.permModeTable")}
            action={
              <div className="settings-segmented" style={{ minWidth: 0 }}>
                <button
                  type="button"
                  className={`chrome-btn${mode === "table" ? " is-active" : ""}`}
                  aria-pressed={mode === "table"}
                  onClick={() => switchMode("table")}
                >
                  {t("settings.permModeTable")}
                </button>
                <button
                  type="button"
                  className={`chrome-btn${mode === "json" ? " is-active" : ""}`}
                  aria-pressed={mode === "json"}
                  onClick={() => switchMode("json")}
                >
                  {t("settings.permModeJson")}
                </button>
              </div>
            }
          >
            {mode === "table" ? (
              <>
                <div className="settings-perm-head">
                  <span>{t("settings.permColSurface")}</span>
                  <span>{t("settings.permColPattern")}</span>
                  <span>{t("settings.permColAction")}</span>
                  <span>{t("settings.permColReason")}</span>
                  <span />
                </div>
                {rows.map((row) => (
                  <div key={row.id} className="settings-perm-row">
                    <input
                      className="input-base"
                      list="perm-surfaces"
                      value={row.surface}
                      onChange={(e) => updateRow(row.id, { surface: e.target.value })}
                      style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                      spellCheck={false}
                    />
                    <input
                      className="input-base"
                      value={row.pattern}
                      placeholder="*"
                      onChange={(e) => updateRow(row.id, { pattern: e.target.value })}
                      style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                      spellCheck={false}
                      title={t("settings.permPatternHint")}
                    />
                    <select
                      className="input-base"
                      value={row.action}
                      onChange={(e) => updateRow(row.id, { action: e.target.value as PermissionAction })}
                      style={{ fontSize: 12 }}
                    >
                      {PERMISSION_ACTIONS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <input
                      className="input-base"
                      value={row.reason ?? ""}
                      onChange={(e) => updateRow(row.id, { reason: e.target.value })}
                      style={{ fontSize: 12 }}
                      placeholder="—"
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeRow(row.id)}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Icon icon={Trash2} size="sm" />
                    </button>
                  </div>
                ))}
                <datalist id="perm-surfaces">
                  {COMMON_SURFACES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <div className="settings-card-footer">
                  <button type="button" className="btn-ghost btn-compact" onClick={addRow}>
                    <Icon icon={Plus} size="sm" />
                    {t("settings.permAddRule")}
                  </button>
                </div>
              </>
            ) : (
              <textarea
                className="input-base settings-perm-json"
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setDirty(true);
                  setNotice(null);
                }}
                spellCheck={false}
                rows={18}
                aria-label={t("settings.permJsonLabel")}
              />
            )}
          </SettingsGroup>

          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-primary btn-compact"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? t("common.loading") : t("settings.permSave")}
            </button>
            <button type="button" className="btn-ghost btn-compact" disabled={saving} onClick={() => void load()}>
              {t("settings.permReload")}
            </button>
            <button type="button" className="btn-ghost btn-compact" disabled={saving} onClick={() => void resetDefaults()}>
              {t("settings.permResetDefaults")}
            </button>
          </div>

          {error && (
            <div style={{ color: "var(--destructive)", fontSize: 12, marginBottom: 10 }}>{error}</div>
          )}
          {notice && !error && (
            <div style={{ color: "var(--success)", fontSize: 12, marginBottom: 10 }}>{notice}</div>
          )}

          <div className="settings-row-desc" style={{ color: "var(--text-dim)" }}>
            {policyPath}
            {!policyExists ? ` · ${t("settings.permNotOnDisk")}` : ""}
          </div>
          <div className="settings-row-desc" style={{ marginTop: 8, color: "var(--text-dim)" }}>
            {t("settings.permHelp")}
          </div>
        </>
      )}
    </div>
  );
}
