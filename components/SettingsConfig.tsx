"use client";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/hooks/useLocale";

type ModelOption = {
  provider: string;
  modelId: string;
  name: string;
};

type Props = {
  onClose: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenMcp?: () => void;
  skillsDisabled?: boolean;
  /** Used to list available models for utility-task pickers. */
  cwd?: string | null;
};

function modelValue(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function SegmentedOption({
  active,
  label,
  onClick,
  title,
}: {
  active: boolean;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`chrome-btn${active ? " is-active" : ""}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        height: 28,
        minHeight: 28,
        padding: "0 12px",
        fontSize: 12,
        fontWeight: 600,
        flex: "1 1 0",
      }}
    >
      {label}
    </button>
  );
}

function SettingsRow({
  title,
  description,
  action,
  stacked = false,
}: {
  title: string;
  description?: string;
  action: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "center",
        justifyContent: "space-between",
        gap: stacked ? 8 : 16,
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</div>
        {description && (
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
            {description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, width: stacked ? "100%" : undefined }}>{action}</div>
    </div>
  );
}

export function SettingsConfig({
  onClose,
  onOpenModels,
  onOpenSkills,
  onOpenMcp,
  skillsDisabled = false,
  cwd = null,
}: Props) {
  const { t, locale, setLocale } = useLocale();
  const { isDark, toggleTheme } = useTheme();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [titleModelRef, setTitleModelRef] = useState("");
  const [commitModelRef, setCommitModelRef] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [savingKey, setSavingKey] = useState<"titleModel" | "commitModel" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<
    | { kind: "idle" }
    | { kind: "latest" }
    | { kind: "available"; version: string; releaseUrl: string }
    | { kind: "empty" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-update")
      .then(async (res) => {
        const data = await res.json() as { currentVersion?: string; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) setCurrentVersion(data.currentVersion ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrentVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    setSaveError(null);
    const params = new URLSearchParams();
    if (cwd) params.set("cwd", cwd);
    fetch(`/api/web-settings?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json() as {
          settings?: { titleModelRef?: string; commitModelRef?: string };
          models?: ModelOption[];
          error?: string;
        };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setModels(data.models ?? []);
        setTitleModelRef(data.settings?.titleModelRef ?? "");
        setCommitModelRef(data.settings?.commitModelRef ?? "");
      })
      .catch((error) => {
        if (cancelled) return;
        setSaveError(error instanceof Error ? error.message : String(error));
        setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const saveModelPref = useCallback(async (
    key: "titleModel" | "commitModel",
    value: string,
  ) => {
    setSavingKey(key);
    setSaveError(null);
    if (key === "titleModel") setTitleModelRef(value);
    else setCommitModelRef(value);
    try {
      const res = await fetch("/api/web-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value || null }),
      });
      const data = await res.json() as {
        error?: string;
        settings?: { titleModelRef?: string; commitModelRef?: string };
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTitleModelRef(data.settings?.titleModelRef ?? (key === "titleModel" ? value : titleModelRef));
      setCommitModelRef(data.settings?.commitModelRef ?? (key === "commitModel" ? value : commitModelRef));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingKey(null);
    }
  }, [commitModelRef, titleModelRef]);

  const checkForAppUpdate = useCallback(async () => {
    setUpdateChecking(true);
    setUpdateStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/app-update", { method: "POST" });
      const data = await res.json() as {
        currentVersion?: string;
        latestVersion?: string | null;
        updateAvailable?: boolean;
        releaseUrl?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.currentVersion) setCurrentVersion(data.currentVersion);

      if (data.message === "no_releases") {
        setUpdateStatus({ kind: "empty" });
        return;
      }

      if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
        setUpdateStatus({
          kind: "available",
          version: data.latestVersion,
          releaseUrl: data.releaseUrl,
        });
        // Jump to the latest GitHub release so the user can download/update.
        window.open(data.releaseUrl, "_blank", "noopener,noreferrer");
        return;
      }

      setUpdateStatus({ kind: "latest" });
    } catch (error) {
      setUpdateStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  const modelSelect = (
    value: string,
    key: "titleModel" | "commitModel",
    defaultLabel: string,
  ) => (
    <select
      className="input-base input-mono"
      value={value}
      disabled={loadingModels || savingKey === key}
      onChange={(e) => void saveModelPref(key, e.target.value)}
      style={{
        width: "100%",
        maxWidth: "100%",
        height: 32,
        fontSize: 12,
      }}
      aria-label={key === "titleModel" ? t("settings.titleModel") : t("settings.commitModel")}
    >
      <option value="">{defaultLabel}</option>
      {models.map((m) => {
        const ref = modelValue(m.provider, m.modelId);
        return (
          <option key={ref} value={ref}>
            {m.name} · {m.provider}
          </option>
        );
      })}
      {/* Keep a stale configured value selectable until the user changes it. */}
      {value && !models.some((m) => modelValue(m.provider, m.modelId) === value) && (
        <option value={value}>{value} ({t("settings.modelUnavailable")})</option>
      )}
    </select>
  );

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        style={{
          width: "min(520px, calc(100vw - 16px))",
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "calc(100dvh - 16px)",
        }}
      >
        <div className="modal-header">
          <div className="modal-header-meta">
            <span className="modal-title">{t("settings.title")}</span>
          </div>
          <button
            type="button"
            className="chrome-btn is-icon"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="modal-body" style={{ display: "block", overflow: "auto" }}>
          <div className="modal-main" style={{ padding: "4px 16px 16px" }}>
            <div className="modal-section-title" style={{ marginTop: 8, marginBottom: 4 }}>
              {t("settings.general")}
            </div>

            <SettingsRow
              title={t("settings.theme")}
              description={t("settings.themeDesc")}
              action={
                <div
                  style={{
                    display: "inline-flex",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    minWidth: 148,
                  }}
                >
                  <SegmentedOption
                    active={!isDark}
                    label={t("settings.themeLight")}
                    title={t("shell.switchToLight")}
                    onClick={(e) => {
                      if (isDark) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                      }
                    }}
                  />
                  <SegmentedOption
                    active={isDark}
                    label={t("settings.themeDark")}
                    title={t("shell.switchToDark")}
                    onClick={(e) => {
                      if (!isDark) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                      }
                    }}
                  />
                </div>
              }
            />

            <SettingsRow
              title={t("settings.language")}
              description={t("settings.languageDesc")}
              action={
                <div
                  style={{
                    display: "inline-flex",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    minWidth: 148,
                  }}
                >
                  <SegmentedOption
                    active={locale === "en"}
                    label={t("settings.languageEn")}
                    title={t("shell.switchToEn")}
                    onClick={() => setLocale("en")}
                  />
                  <SegmentedOption
                    active={locale === "zh"}
                    label={t("settings.languageZh")}
                    title={t("shell.switchToZh")}
                    onClick={() => setLocale("zh")}
                  />
                </div>
              }
            />

            <div className="modal-section-title" style={{ marginTop: 18, marginBottom: 4 }}>
              {t("settings.utilityModels")}
            </div>

            <SettingsRow
              stacked
              title={t("settings.titleModel")}
              description={t("settings.titleModelDesc")}
              action={modelSelect(
                titleModelRef,
                "titleModel",
                loadingModels ? t("common.loading") : t("settings.titleModelDefault"),
              )}
            />

            <SettingsRow
              stacked
              title={t("settings.commitModel")}
              description={t("settings.commitModelDesc")}
              action={modelSelect(
                commitModelRef,
                "commitModel",
                loadingModels ? t("common.loading") : t("settings.commitModelDefault"),
              )}
            />

            {saveError && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
                {saveError}
              </div>
            )}

            <div className="modal-section-title" style={{ marginTop: 18, marginBottom: 4 }}>
              {t("settings.agent")}
            </div>

            <SettingsRow
              title={t("settings.models")}
              description={t("settings.modelsDesc")}
              action={
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={onOpenModels}
                >
                  {t("settings.open")}
                </button>
              }
            />

            <SettingsRow
              title={t("settings.skills")}
              description={
                skillsDisabled ? t("settings.skillsNeedCwd") : t("settings.skillsDesc")
              }
              action={
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={onOpenSkills}
                  disabled={skillsDisabled}
                  title={skillsDisabled ? t("settings.skillsNeedCwd") : undefined}
                >
                  {t("settings.open")}
                </button>
              }
            />

            <SettingsRow
              title={t("settings.mcp")}
              description={t("settings.mcpDesc")}
              action={
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={onOpenMcp}
                  disabled={!onOpenMcp}
                >
                  {t("settings.open")}
                </button>
              }
            />

            <div className="modal-section-title" style={{ marginTop: 18, marginBottom: 4 }}>
              {t("settings.about")}
            </div>

            <SettingsRow
              title={t("settings.version")}
              description={
                currentVersion
                  ? t("settings.versionCurrent", { version: currentVersion })
                  : t("common.loading")
              }
              action={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {updateStatus.kind === "available" && (
                    <button
                      type="button"
                      className="btn-primary btn-compact"
                      onClick={() => {
                        window.open(updateStatus.releaseUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      {t("settings.updateOpen")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={() => void checkForAppUpdate()}
                    disabled={updateChecking}
                  >
                    {updateChecking ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
                  </button>
                </div>
              }
            />

            {updateStatus.kind === "available" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--success)", lineHeight: 1.4 }}>
                {t("settings.updateAvailable", { version: updateStatus.version })}
              </div>
            )}
            {updateStatus.kind === "latest" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                {t("settings.updateLatest")}
              </div>
            )}
            {updateStatus.kind === "empty" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                {t("settings.updateNoReleases")}
              </div>
            )}
            {updateStatus.kind === "error" && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
                {t("settings.updateError")}: {updateStatus.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
