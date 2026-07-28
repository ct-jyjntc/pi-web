"use client";

import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { McpConfig } from "./McpConfig";

export type SettingsSection = "general" | "models" | "skills" | "mcp";

type ModelOption = {
  provider: string;
  modelId: string;
  name: string;
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
    <div className={`settings-row${stacked ? " is-stacked" : ""}`}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <div style={{ flexShrink: 0, width: stacked ? "100%" : undefined }}>{action}</div>
    </div>
  );
}

function sectionTitle(text: string) {
  return <div className="settings-section-title">{text}</div>;
}

export function SettingsPage({
  onClose,
  cwd = null,
  skillsDisabled = false,
  initialSection = "general",
  onModelsChanged,
}: {
  onClose: () => void;
  cwd?: string | null;
  skillsDisabled?: boolean;
  initialSection?: SettingsSection;
  onModelsChanged?: () => void;
}) {
  const { t, locale, setLocale } = useLocale();
  const { isDark, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [section, setSection] = useState<SettingsSection>(initialSection);

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/app-update");
        const data = await res.json() as { currentVersion?: string };
        if (!cancelled && data.currentVersion) setCurrentVersion(data.currentVersion);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveModelPref = useCallback(async (key: "titleModel" | "commitModel", value: string) => {
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
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
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
        height: 30,
        minHeight: 30,
        fontSize: 12,
        borderRadius: 0,
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
      {value && !models.some((m) => modelValue(m.provider, m.modelId) === value) && (
        <option value={value}>{value} ({t("settings.modelUnavailable")})</option>
      )}
    </select>
  );

  const navItems: Array<{
    id: SettingsSection;
    label: string;
    disabled?: boolean;
    title?: string;
  }> = [
    { id: "general", label: t("settings.general") },
    { id: "models", label: t("settings.models") },
    {
      id: "skills",
      label: t("settings.skills"),
      disabled: skillsDisabled,
      title: skillsDisabled ? t("settings.skillsNeedCwd") : undefined,
    },
    { id: "mcp", label: t("settings.mcp") },
  ];

  const generalPanel = (
    <div
      className="settings-page-general"
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: 820,
        margin: "0 auto",
        padding: isMobile ? "12px 14px 28px" : "16px 24px 32px",
      }}
    >
      {sectionTitle(t("settings.general"))}

      <SettingsRow
        title={t("settings.theme")}
        description={t("settings.themeDesc")}
        action={
          <div className="settings-segmented">
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
          <div className="settings-segmented">
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

      {sectionTitle(t("settings.utilityModels"))}

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

      {sectionTitle(t("settings.about"))}

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
  );

  // Critical layout is inlined so a CSS-load race cannot leave settings
  // flowing through the main shell (what looked like a "CSS collapse").
  const rootStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg)",
    color: "var(--text)",
  };
  const topbarStyle: CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
    height: "var(--titlebar-height)",
    minHeight: "var(--titlebar-height)",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-panel)",
    overflow: "hidden",
    minWidth: 0,
  };
  const bodyStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minHeight: 0,
    flexDirection: isMobile ? "column" : "row",
  };
  const navStyle: CSSProperties = isMobile
    ? {
        width: "100%",
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        overflowX: "auto",
        overflowY: "hidden",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }
    : {
        width: "var(--sidebar-width)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-panel)",
        padding: "8px 0",
      };
  const mainStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: section === "general" ? "auto" : "hidden",
    background: "var(--bg)",
  };

  const page = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      className="settings-page"
      style={rootStyle}
    >
      <div className="settings-page-topbar app-topbar titlebar-drag desktop-top-chrome" style={topbarStyle}>
        <div className="traffic-lights-spacer titlebar-drag" aria-hidden />
        <div className="chrome-cluster titlebar-no-drag" style={{ flexShrink: 0, display: "flex", alignItems: "stretch", height: "100%" }}>
          <button
            type="button"
            className="chrome-btn"
            onClick={onClose}
            style={{
              height: "100%",
              minHeight: 0,
              borderRadius: 0,
              borderRight: "1px solid var(--border)",
              padding: "0 12px",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>{t("settings.backToWorkspace")}</span>
          </button>
        </div>
        <div
          className="settings-page-topbar-title titlebar-no-drag"
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text)",
            whiteSpace: "nowrap",
            borderRight: "1px solid var(--border)",
          }}
        >
          {t("settings.title")}
        </div>
        <div className="titlebar-drag" style={{ flex: 1, minWidth: 0 }} />
      </div>

      <div className={`settings-page-body${isMobile ? " is-mobile" : ""}`} style={bodyStyle}>
        <nav
          aria-label={t("settings.title")}
          className={`settings-page-nav${isMobile ? " is-mobile" : ""}`}
          style={navStyle}
        >
          {!isMobile && (
            <div
              className="settings-page-nav-label"
              style={{
                padding: "8px 12px 6px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
              }}
            >
              {t("settings.navGroup")}
            </div>
          )}
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`settings-page-nav-item${active ? " is-active" : ""}`}
                disabled={item.disabled}
                title={item.title}
                onClick={() => setSection(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: isMobile ? "auto" : "100%",
                  height: isMobile ? "var(--titlebar-height)" : 32,
                  minHeight: isMobile ? "var(--titlebar-height)" : 32,
                  padding: isMobile ? "0 14px" : "0 12px",
                  border: "none",
                  borderRight: isMobile ? "1px solid var(--border)" : "none",
                  borderRadius: 0,
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  font: "inherit",
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: active ? 600 : 500,
                  textAlign: "left",
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  opacity: item.disabled ? 0.45 : 1,
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <main className={`settings-page-main${section === "general" ? " is-scroll" : ""}`} style={mainStyle}>
          {section === "general" && generalPanel}
          {section === "models" && (
            <ModelsConfig
              embedded
              onClose={() => {
                onModelsChanged?.();
              }}
            />
          )}
          {section === "skills" && cwd && (
            <SkillsConfig embedded cwd={cwd} onClose={onClose} />
          )}
          {section === "skills" && !cwd && (
            <div className="settings-page-empty" style={{ padding: "24px 16px", color: "var(--text-muted)", fontSize: 13 }}>
              {t("settings.skillsNeedCwd")}
            </div>
          )}
          {section === "mcp" && (
            <McpConfig embedded cwd={cwd} onClose={onClose} />
          )}
        </main>
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(page, document.body);
}
