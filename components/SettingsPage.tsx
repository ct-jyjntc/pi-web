"use client";

import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { McpConfig } from "./McpConfig";
import { SettingsToggle } from "./SettingsToggle";
import { UsagePanel, prefetchUsage } from "./UsagePanel";
import { CODE_THEME_OPTIONS, getCodeThemeStyle, SyntaxHighlighter } from "@/lib/syntax-highlighter";
import { setAppearanceSnapshot, useAppearance } from "@/lib/appearance-store";
import { getAppUpdateInfo, setAppUpdateInfo, subscribeAppUpdate } from "@/lib/app-update-store";
import {
  applyWebSettings,
  fetchWebSettingsWithModels,
  invalidateWebSettings,
  type WebSettingsData,
} from "@/lib/web-settings-store";
import type { CodeThemeId, ThemeMode } from "@/lib/web-settings";
import { Icon } from "./Icon";
import { ChevronLeft } from "lucide-react";

export type SettingsSection =
  | "general"
  | "agent"
  | "memory"
  | "network"
  | "usage"
  | "appearance"
  | "models"
  | "skills"
  | "mcp"
  | "tools";

type LspServerRow = {
  id: string;
  label: string;
  command: string;
  languages: string[];
  available: boolean;
  resolvedPath: string | null;
  /** Platform-resolved install command (not brew-first). */
  install: string;
  installTip?: string;
  brew?: string;
  platform?: string;
};

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
  visible = true,
}: {
  onClose: () => void;
  cwd?: string | null;
  skillsDisabled?: boolean;
  initialSection?: SettingsSection;
  onModelsChanged?: () => void;
  /** AppShell keeps the page warm-mounted after first use / idle warmup and
   * toggles this instead of unmounting, so reopening is instant and state
   * (section, models, prefs) survives. */
  visible?: boolean;
}) {
  const { t, locale, setLocale } = useLocale();
  const { isDark, setThemeMode, themeMode } = useTheme();
  const appearance = useAppearance();
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [lspServers, setLspServers] = useState<LspServerRow[] | null>(null);
  const [lspMeta, setLspMeta] = useState<{ availableCount: number; total: number; builtinNote?: string } | null>(null);
  const [lspLoading, setLspLoading] = useState(false);
  const [lspError, setLspError] = useState<string | null>(null);
  const [lspCopiedId, setLspCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);
  // Body scroll is locked only while the overlay is actually visible — the page
  // may be warm-mounted hidden so a reopen is instant.
  useEffect(() => {
    if (!visible) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [visible]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [titleModelRef, setTitleModelRef] = useState("");
  const [commitModelRef, setCommitModelRef] = useState("");
  const [roleDefaultRef, setRoleDefaultRef] = useState("");
  const [roleSmolRef, setRoleSmolRef] = useState("");
  const [rolePlanRef, setRolePlanRef] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [savingKey, setSavingKey] = useState<
    "titleModel" | "commitModel" | "roleDefault" | "roleSmol" | "rolePlan" | null
  >(null);
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
  const [prefs, setPrefs] = useState({
    httpProxy: "",
    proxyBypass: "",
    customCaCerts: "",
    soundEnabled: true,
    desktopNotifications: true,
    notificationSound: true,
    defaultThinkingLevel: "auto",
    showThinking: true,
    showTodos: true,
    terminalFont: "",
    inheritTerminalEnv: true,
    disableHardwareAcceleration: false,
    autoCheckUpdates: true,
    autoDownloadUpdates: false,
    projectMemoryEnabled: false,
    projectMemoryAutoInject: false,
    projectMemoryTopK: 12,
    advisorEnabled: false,
  });
  const [advisorModelRef, setAdvisorModelRef] = useState("");
  const [memoryFacts, setMemoryFacts] = useState<Array<{ id: string; text: string }>>([]);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryReflectBusy, setMemoryReflectBusy] = useState(false);
  const [memoryReflectText, setMemoryReflectText] = useState<string | null>(null);
  const [memoryReflectMeta, setMemoryReflectMeta] = useState<string | null>(null);
  const [networkTesting, setNetworkTesting] = useState(false);
  const [networkReport, setNetworkReport] = useState<{
    summary?: { fetchOk: number; fetchTotal: number; searchOk: boolean | null };
    fetches?: Array<{ url: string; ok: boolean; status?: number; ms: number; error?: string }>;
    search?: { ok: boolean; ms: number; count?: number; error?: string; first?: { title: string; url: string } };
    proxy?: { httpProxy?: string; envHttpProxy?: string };
    error?: string;
  } | null>(null);
  const [restartHint, setRestartHint] = useState(false);
  const isDesktop = typeof window !== "undefined" && Boolean(window.piDesktop?.isDesktop);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, visible]);

  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    setSaveError(null);
    // Full read (this panel is the only consumer of the utility-model catalog);
    // it also refreshes the shared settings cache for everyone else.
    fetchWebSettingsWithModels(cwd)
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setTitleModelRef(data.settings?.titleModelRef ?? "");
        setCommitModelRef(data.settings?.commitModelRef ?? "");
        setRoleDefaultRef(data.settings?.modelRolesRefs?.default ?? "");
        setRoleSmolRef(data.settings?.modelRolesRefs?.smol ?? "");
        setRolePlanRef(data.settings?.modelRolesRefs?.plan ?? "");
        const s = data.settings ?? {};
        setPrefs((prev) => ({
          ...prev,
          httpProxy: typeof s.httpProxy === "string" ? s.httpProxy : prev.httpProxy,
          proxyBypass: typeof s.proxyBypass === "string" ? s.proxyBypass : prev.proxyBypass,
          customCaCerts: typeof s.customCaCerts === "string" ? s.customCaCerts : prev.customCaCerts,
          soundEnabled: typeof s.soundEnabled === "boolean" ? s.soundEnabled : prev.soundEnabled,
          desktopNotifications: typeof s.desktopNotifications === "boolean" ? s.desktopNotifications : prev.desktopNotifications,
          notificationSound: typeof s.notificationSound === "boolean" ? s.notificationSound : prev.notificationSound,
          defaultThinkingLevel: typeof s.defaultThinkingLevel === "string" ? s.defaultThinkingLevel : prev.defaultThinkingLevel,
          showThinking: typeof s.showThinking === "boolean" ? s.showThinking : prev.showThinking,
          showTodos: typeof s.showTodos === "boolean" ? s.showTodos : prev.showTodos,
          terminalFont: typeof s.terminalFont === "string" ? s.terminalFont : prev.terminalFont,
          inheritTerminalEnv: typeof s.inheritTerminalEnv === "boolean" ? s.inheritTerminalEnv : prev.inheritTerminalEnv,
          disableHardwareAcceleration: typeof s.disableHardwareAcceleration === "boolean" ? s.disableHardwareAcceleration : prev.disableHardwareAcceleration,
          autoCheckUpdates: typeof s.autoCheckUpdates === "boolean" ? s.autoCheckUpdates : prev.autoCheckUpdates,
          autoDownloadUpdates: typeof s.autoDownloadUpdates === "boolean" ? s.autoDownloadUpdates : prev.autoDownloadUpdates,
          projectMemoryEnabled:
            s.projectMemory && typeof s.projectMemory === "object" && !Array.isArray(s.projectMemory)
            && typeof (s.projectMemory as { enabled?: unknown }).enabled === "boolean"
              ? (s.projectMemory as { enabled: boolean }).enabled
              : prev.projectMemoryEnabled,
          projectMemoryAutoInject:
            s.projectMemory && typeof s.projectMemory === "object" && !Array.isArray(s.projectMemory)
              ? (s.projectMemory as { autoInject?: unknown }).autoInject === true
              : prev.projectMemoryAutoInject,
          projectMemoryTopK:
            s.projectMemory && typeof s.projectMemory === "object" && !Array.isArray(s.projectMemory)
            && typeof (s.projectMemory as { autoInjectTopK?: unknown }).autoInjectTopK === "number"
              ? (s.projectMemory as { autoInjectTopK: number }).autoInjectTopK
              : prev.projectMemoryTopK,
          advisorEnabled: typeof s.advisorEnabled === "boolean" ? s.advisorEnabled : prev.advisorEnabled,
        }));
        setAdvisorModelRef(
          typeof s.advisorModel === "object" && s.advisorModel && !Array.isArray(s.advisorModel)
            && typeof (s.advisorModel as { provider?: string }).provider === "string"
            && typeof (s.advisorModel as { modelId?: string }).modelId === "string"
            ? `${(s.advisorModel as { provider: string }).provider}/${(s.advisorModel as { modelId: string }).modelId}`
            : "",
        );
        if (typeof s.terminalFont === "string") {
          try { localStorage.setItem("pi-terminal-font", s.terminalFont); } catch { /* ignore */ }
        }
        if (typeof s.soundEnabled === "boolean") {
          try { localStorage.setItem("pi-sound-enabled", String(s.soundEnabled)); } catch { /* ignore */ }
        }

        if (cwd) {
          void fetch(`/api/project-memory?cwd=${encodeURIComponent(cwd)}`)
            .then(async (r) => {
              const mem = await r.json() as { facts?: Array<{ id: string; text: string }> };
              if (!cancelled && Array.isArray(mem.facts)) {
                setMemoryFacts(mem.facts.map((f) => ({ id: f.id, text: f.text })));
              }
            })
            .catch(() => {
              if (!cancelled) setMemoryFacts([]);
            });
        } else if (!cancelled) {
          setMemoryFacts([]);
        }
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
      const data = await res.json() as { error?: string; settings?: WebSettingsData };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      // PUT echoes the whole settings object — refresh the shared cache instead
      // of leaving other consumers on a stale copy for up to a refresh window.
      if (data.settings) applyWebSettings(data.settings);
      setTitleModelRef(data.settings?.titleModelRef ?? (key === "titleModel" ? value : titleModelRef));
      setCommitModelRef(data.settings?.commitModelRef ?? (key === "commitModel" ? value : commitModelRef));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      invalidateWebSettings();
    } finally {
      setSavingKey(null);
    }
  }, [commitModelRef, titleModelRef]);

  const saveRoleModel = useCallback(async (
    role: "default" | "smol" | "plan",
    value: string,
  ) => {
    const key = role === "default" ? "roleDefault" : role === "smol" ? "roleSmol" : "rolePlan";
    setSavingKey(key);
    setSaveError(null);
    if (role === "default") setRoleDefaultRef(value);
    else if (role === "smol") setRoleSmolRef(value);
    else setRolePlanRef(value);
    try {
      const res = await fetch("/api/web-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRole: role, modelRoleRef: value || null }),
      });
      const data = await res.json() as { error?: string; settings?: WebSettingsData };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.settings) applyWebSettings(data.settings);
      setRoleDefaultRef(data.settings?.modelRolesRefs?.default ?? (role === "default" ? value : roleDefaultRef));
      setRoleSmolRef(data.settings?.modelRolesRefs?.smol ?? (role === "smol" ? value : roleSmolRef));
      setRolePlanRef(data.settings?.modelRolesRefs?.plan ?? (role === "plan" ? value : rolePlanRef));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      invalidateWebSettings();
    } finally {
      setSavingKey(null);
    }
  }, [roleDefaultRef, rolePlanRef, roleSmolRef]);

  const patchPref = useCallback(async (patch: Record<string, unknown>, opts?: { restart?: boolean }) => {
    setSaveError(null);
    setPrefs((prev) => ({ ...prev, ...patch } as typeof prev));
    try {
      const res = await fetch("/api/web-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json() as { error?: string; settings?: WebSettingsData };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Push the saved values into the shared cache so thinking blocks, the
      // terminal font, sound and appearance consumers see them immediately.
      if (data.settings) applyWebSettings(data.settings);
      if (opts?.restart) setRestartHint(true);
      if (typeof patch.soundEnabled === "boolean") {
        try { localStorage.setItem("pi-sound-enabled", String(patch.soundEnabled)); } catch { /* ignore */ }
      }
      if (typeof patch.terminalFont === "string") {
        try { localStorage.setItem("pi-terminal-font", patch.terminalFont); } catch { /* ignore */ }
      }
      // Live appearance
      const appearancePatch: Record<string, unknown> = {};
      for (const key of [
        "themeMode", "uiFontSize", "codeThemeLight", "codeThemeDark",
        "showCodeLineNumbers", "wrapCodeLines", "codeFontSize",
      ] as const) {
        if (key in patch) appearancePatch[key] = patch[key];
      }
      if (Object.keys(appearancePatch).length > 0) {
        setAppearanceSnapshot(appearancePatch as Parameters<typeof setAppearanceSnapshot>[0]);
        try {
          localStorage.setItem("pi-appearance", JSON.stringify({
            ...appearance,
            ...appearancePatch,
          }));
        } catch { /* ignore */ }
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      // The optimistic setPrefs above may not match disk — force a refetch.
      invalidateWebSettings();
    }
  }, [appearance]);

  // Sync About panel with the shared store (AppShell owns background auto-check).
  useEffect(() => {
    const info = getAppUpdateInfo();
    if (info) {
      setUpdateStatus({
        kind: "available",
        version: info.latestVersion,
        releaseUrl: info.releaseUrl,
      });
      if (info.currentVersion) setCurrentVersion(info.currentVersion);
    }
    return subscribeAppUpdate(() => {
      const next = getAppUpdateInfo();
      if (next) {
        setUpdateStatus({
          kind: "available",
          version: next.latestVersion,
          releaseUrl: next.releaseUrl,
        });
        if (next.currentVersion) setCurrentVersion(next.currentVersion);
      }
    });
  }, []);

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
        setAppUpdateInfo(null);
        setUpdateStatus({ kind: "empty" });
        return;
      }
      if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
        setAppUpdateInfo({
          currentVersion: data.currentVersion ?? "",
          latestVersion: data.latestVersion,
          releaseUrl: data.releaseUrl,
          checkedAt: Date.now(),
        });
        setUpdateStatus({
          kind: "available",
          version: data.latestVersion,
          releaseUrl: data.releaseUrl,
        });
        window.open(data.releaseUrl, "_blank", "noopener,noreferrer");
        return;
      }
      setAppUpdateInfo(null);
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
      style={{ width: "100%", maxWidth: "100%" }}
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

  const roleModelSelect = (
    value: string,
    role: "default" | "smol" | "plan",
    defaultLabel: string,
    ariaLabel: string,
  ) => {
    const saving =
      (role === "default" && savingKey === "roleDefault")
      || (role === "smol" && savingKey === "roleSmol")
      || (role === "plan" && savingKey === "rolePlan");
    return (
      <select
        className="input-base input-mono"
        value={value}
        disabled={loadingModels || saving}
        onChange={(e) => void saveRoleModel(role, e.target.value)}
        style={{ width: "100%", maxWidth: "100%" }}
        aria-label={ariaLabel}
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
  };

  type NavItem = {
    id: SettingsSection;
    label: string;
    disabled?: boolean;
    title?: string;
  };

  // Grouped so app chrome, agent prefs, and integrations stay distinct.
  const navGroups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: t("settings.navGroupApp"),
      items: [
        { id: "general", label: t("settings.general") },
        { id: "appearance", label: t("settings.appearance") },
        { id: "usage", label: t("settings.usage") },
        { id: "network", label: t("settings.network") },
      ],
    },
    {
      label: t("settings.navGroupAgent"),
      items: [
        { id: "agent", label: t("settings.agent") },
        { id: "memory", label: t("settings.memory") },
      ],
    },
    {
      label: t("settings.navGroupIntegrations"),
      items: [
        { id: "models", label: t("settings.models") },
        {
          id: "skills",
          label: t("settings.skills"),
          // Keep selectable so users see the empty-state CTA instead of a dead nav row.
          title: skillsDisabled ? t("settings.skillsNeedCwd") : undefined,
        },
        { id: "mcp", label: t("settings.mcp") },
        // Content is LSP health only — label matches the panel, not generic "Tools".
        { id: "tools", label: t("settings.lsp") },
      ],
    },
  ];

  const loadLspHealth = useCallback(async () => {
    setLspLoading(true);
    setLspError(null);
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      const res = await fetch(`/api/lsp?${params.toString()}`);
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        servers?: LspServerRow[];
        availableCount?: number;
        total?: number;
        builtinNote?: string;
      };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLspServers(Array.isArray(data.servers) ? data.servers : []);
      setLspMeta({
        availableCount: data.availableCount ?? 0,
        total: data.total ?? 0,
        builtinNote: data.builtinNote,
      });
    } catch (error) {
      setLspError(error instanceof Error ? error.message : String(error));
    } finally {
      setLspLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (section === "tools") void loadLspHealth();
  }, [section, loadLspHealth]);

  // Warm usage aggregate while the user is still on other settings tabs.
  useEffect(() => {
    prefetchUsage(30);
  }, []);

  // Avoid stale scroll when switching between long form pages and dual-pane panels.
  useEffect(() => {
    const main = document.querySelector(".settings-page-main");
    if (main instanceof HTMLElement) main.scrollTop = 0;
  }, [section]);

  const saveErrorBlock = saveError ? (
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
      {saveError}
    </div>
  ) : null;

  const generalHeadPanel = (
    <>
      {sectionTitle(t("settings.general"))}

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

    </>
  );

  const agentModelsPanel = (
    <>
      {sectionTitle(t("settings.modelRoles"))}

      <SettingsRow
        stacked
        title={t("settings.roleDefault")}
        description={t("settings.roleDefaultDesc")}
        action={roleModelSelect(
          roleDefaultRef,
          "default",
          loadingModels ? t("common.loading") : t("settings.roleDefaultFallback"),
          t("settings.roleDefault"),
        )}
      />

      <SettingsRow
        stacked
        title={t("settings.roleSmol")}
        description={t("settings.roleSmolDesc")}
        action={roleModelSelect(
          roleSmolRef,
          "smol",
          loadingModels ? t("common.loading") : t("settings.roleSmolFallback"),
          t("settings.roleSmol"),
        )}
      />

      <SettingsRow
        stacked
        title={t("settings.rolePlan")}
        description={t("settings.rolePlanDesc")}
        action={roleModelSelect(
          rolePlanRef,
          "plan",
          loadingModels ? t("common.loading") : t("settings.rolePlanFallback"),
          t("settings.rolePlan"),
        )}
      />

      <div style={{ margin: "4px 0 14px" }}>
        <button
          type="button"
          className="btn-ghost btn-compact"
          onClick={() => setSection("models")}
        >
          {t("settings.manageProviders")}
        </button>
      </div>

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

      {saveErrorBlock}
    </>
  );

  const networkPanel = (
    <>

      {sectionTitle(t("settings.network"))}

      <SettingsRow
        stacked
        title={t("settings.httpProxy")}
        description={t("settings.httpProxyDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.httpProxy}
            placeholder={t("settings.httpProxyPlaceholder")}
            onChange={(e) => setPrefs((p) => ({ ...p, httpProxy: e.target.value }))}
            onBlur={() => void patchPref({ httpProxy: prefs.httpProxy }, { restart: true })}
            style={{ width: "100%" }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.proxyBypass")}
        description={t("settings.proxyBypassDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.proxyBypass}
            placeholder={t("settings.proxyBypassPlaceholder")}
            onChange={(e) => setPrefs((p) => ({ ...p, proxyBypass: e.target.value }))}
            onBlur={() => void patchPref({ proxyBypass: prefs.proxyBypass }, { restart: true })}
            style={{ width: "100%" }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.customCa")}
        description={t("settings.customCaDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.customCaCerts}
            placeholder={t("settings.customCaPlaceholder")}
            onChange={(e) => setPrefs((p) => ({ ...p, customCaCerts: e.target.value }))}
            onBlur={() => void patchPref({ customCaCerts: prefs.customCaCerts }, { restart: true })}
            style={{ width: "100%" }}
          />
        }
      />

      <SettingsRow
        stacked
        title={t("settings.networkTest")}
        description={t("settings.networkTestDesc")}
        action={
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <button
              type="button"
              className="btn-primary btn-compact"
              disabled={networkTesting}
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                setNetworkTesting(true);
                setNetworkReport(null);
                void fetch("/api/network/test", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                })
                  .then(async (res) => {
                    const data = await res.json() as typeof networkReport & { error?: string };
                    if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
                    setNetworkReport(data);
                  })
                  .catch((e) => setNetworkReport({ error: e instanceof Error ? e.message : String(e) }))
                  .finally(() => setNetworkTesting(false));
              }}
            >
              {networkTesting ? t("settings.networkTestRunning") : t("settings.networkTestRun")}
            </button>
            {networkReport && (
              <div
                className="settings-status-card"
                style={{ flexDirection: "column", alignItems: "stretch", gap: 0, lineHeight: 1.45 }}
              >
                {networkReport.error ? (
                  <div style={{ color: "var(--destructive)" }}>{networkReport.error}</div>
                ) : (
                  <>
                    <div style={{ marginBottom: 6 }}>
                      {t("settings.networkTestOk", {
                        ok: networkReport.summary?.fetchOk ?? 0,
                        total: networkReport.summary?.fetchTotal ?? 0,
                      })}
                      {" · proxy="}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {networkReport.proxy?.httpProxy || networkReport.proxy?.envHttpProxy || "(none)"}
                      </span>
                    </div>
                    <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                      {(networkReport.fetches ?? []).map((f) => (
                        <li key={f.url} style={{ marginBottom: 4 }}>
                          <span style={{ color: f.ok ? "var(--success)" : "var(--destructive)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                            {f.ok ? `HTTP ${f.status}` : "FAIL"}
                          </span>
                          {" "}
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{f.url}</span>
                          <span style={{ color: "var(--text-dim)" }}> ({f.ms}ms)</span>
                          {f.error && <div style={{ color: "var(--destructive)", fontSize: 11 }}>{f.error}</div>}
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 8 }}>
                      {networkReport.search?.ok
                        ? t("settings.networkSearchOk", {
                            n: networkReport.search.count ?? 0,
                            ms: networkReport.search.ms,
                          })
                        : `${t("settings.networkSearchFail")}${networkReport.search?.error ? `: ${networkReport.search.error}` : ""}`}
                      {networkReport.search?.first && (
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {networkReport.search.first.title} — {networkReport.search.first.url}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        }
      />

      {saveErrorBlock}
    </>
  );

  const generalSystemPanel = (
    <>
      {sectionTitle(t("settings.terminalSection"))}

      <SettingsRow
        title={t("settings.inheritTerminalEnv")}
        description={t("settings.inheritTerminalEnvDesc")}
        action={
          <SettingsToggle
            enabled={prefs.inheritTerminalEnv}
            onChange={(next) => void patchPref({ inheritTerminalEnv: next })}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.terminalFont")}
        description={t("settings.terminalFontDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.terminalFont}
            placeholder={t("settings.terminalFontPlaceholder")}
            onChange={(e) => setPrefs((p) => ({ ...p, terminalFont: e.target.value }))}
            onBlur={() => void patchPref({ terminalFont: prefs.terminalFont })}
            style={{ width: "100%" }}
          />
        }
      />

      {sectionTitle(t("settings.notificationsSection"))}

      <SettingsRow
        title={t("settings.desktopNotifications")}
        description={t("settings.desktopNotificationsDesc")}
        action={
          <SettingsToggle
            enabled={prefs.desktopNotifications}
            onChange={(next) => {
              void (async () => {
                if (next) {
                  const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
                  if (desktop?.isDesktop && typeof desktop.notify === "function") {
                    // Probe Electron notification path with a short sample.
                    void desktop.notify({
                      title: "Pi Web",
                      body: t("notify.taskComplete"),
                      silent: !prefs.notificationSound,
                    });
                  } else if (typeof Notification !== "undefined") {
                    if (Notification.permission === "default") {
                      await Notification.requestPermission();
                    }
                    if (Notification.permission === "granted") {
                      try {
                        new Notification("Pi Web", {
                          body: t("notify.taskComplete"),
                          silent: !prefs.notificationSound,
                        });
                      } catch {
                        // ignore
                      }
                    }
                  }
                }
                void patchPref({ desktopNotifications: next });
              })();
            }}
          />
        }
      />
      <SettingsRow
        title={t("settings.soundEnabled")}
        description={t("settings.soundEnabledDesc")}
        action={
          <SettingsToggle
            enabled={prefs.soundEnabled}
            onChange={(next) => void patchPref({ soundEnabled: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.notificationSound")}
        description={t("settings.notificationSoundDesc")}
        action={
          <SettingsToggle
            enabled={prefs.notificationSound}
            onChange={(next) => void patchPref({ notificationSound: next })}
          />
        }
      />

    </>
  );

  const agentBehaviorPanel = (
    <>
      {sectionTitle(t("settings.agentBehavior"))}

      <SettingsRow
        stacked
        title={t("settings.defaultThinking")}
        description={t("settings.defaultThinkingDesc")}
        action={
          <select
            className="input-base"
            value={prefs.defaultThinkingLevel}
            onChange={(e) => void patchPref({ defaultThinkingLevel: e.target.value })}
            style={{ width: "100%", maxWidth: 280 }}
          >
            {(["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title={t("settings.showThinking")}
        description={t("settings.showThinkingDesc")}
        action={
          <SettingsToggle
            enabled={prefs.showThinking}
            onChange={(next) => void patchPref({ showThinking: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.showTodos")}
        description={t("settings.showTodosDesc")}
        action={
          <SettingsToggle
            enabled={prefs.showTodos}
            onChange={(next) => void patchPref({ showTodos: next })}
          />
        }
      />
    </>
  );

  const memoryPanel = (
    <>
      {sectionTitle(t("settings.memory"))}

      <SettingsRow
        title={t("settings.projectMemory")}
        description={t("settings.projectMemoryDesc")}
        action={
          <SettingsToggle
            enabled={prefs.projectMemoryEnabled}
            onChange={(next) => {
              setPrefs((p) => ({
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
              setPrefs((p) => ({ ...p, projectMemoryAutoInject: next }));
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
            onChange={(e) => setPrefs((p) => ({
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

      {!cwd && (
        <div className="settings-row-desc" style={{ marginTop: 4, marginBottom: 8 }}>
          {t("settings.projectMemoryNeedCwd")}
        </div>
      )}

      {cwd && prefs.projectMemoryEnabled && (
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("settings.projectMemoryFacts")}</div>
          {memoryFacts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>{t("settings.projectMemoryEmpty")}</div>
          ) : (
            <ul style={{ margin: "0 0 8px", padding: 0, listStyle: "none" }}>
              {memoryFacts.map((f) => (
                <li key={f.id} className="settings-list-row" style={{ alignItems: "center" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}>{f.text}</span>
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    disabled={memoryBusy}
                    onClick={() => {
                      setMemoryBusy(true);
                      void fetch("/api/project-memory", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ cwd, id: f.id }),
                      })
                        .then(async (res) => {
                          const data = await res.json() as { error?: string };
                          if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                          setMemoryFacts((prev) => prev.filter((x) => x.id !== f.id));
                        })
                        .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                        .finally(() => setMemoryBusy(false));
                    }}
                    style={{ flexShrink: 0 }}
                  >
                    {t("settings.projectMemoryDelete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input-base"
              value={newMemoryText}
              onChange={(e) => setNewMemoryText(e.target.value)}
              placeholder={t("settings.projectMemoryAdd")}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn-primary btn-compact"
              disabled={memoryBusy || !newMemoryText.trim()}
              onClick={() => {
                setMemoryBusy(true);
                void fetch("/api/project-memory", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cwd, text: newMemoryText.trim() }),
                })
                  .then(async (res) => {
                    const data = await res.json() as { fact?: { id: string; text: string }; error?: string };
                    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                    if (data.fact) setMemoryFacts((prev) => [data.fact!, ...prev]);
                    setNewMemoryText("");
                  })
                  .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setMemoryBusy(false));
              }}
            >
              {t("settings.projectMemoryAdd")}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-ghost btn-compact"
              disabled={memoryReflectBusy || memoryBusy || memoryFacts.length === 0}
              title={t("settings.projectMemoryReflectDesc")}
              onClick={() => {
                setMemoryReflectBusy(true);
                setMemoryReflectText(null);
                setMemoryReflectMeta(null);
                void fetch("/api/project-memory", {
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
                void fetch("/api/project-memory", {
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
            <div
              style={{
                marginTop: 10,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-subtle)",
                padding: "10px 12px",
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                {memoryReflectMeta && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    {memoryReflectMeta}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  disabled={memoryBusy || memoryReflectBusy || !memoryReflectText.trim()}
                  style={{ marginLeft: "auto", height: 22, minHeight: 22, padding: "0 8px", fontSize: 11 }}
                  title={t("settings.projectMemoryRetainReflectDesc")}
                  onClick={() => {
                    // Store a short durable pointer (first meaningful non-heading line)
                    const lines = memoryReflectText
                      .split("\n")
                      .map((l) => l.trim())
                      .filter((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("mode:") && !l.startsWith("facts"));
                    const pick = lines.find((l) => l.startsWith("-") || l.match(/^\d+\./)) ?? lines[0] ?? "";
                    const text = pick.replace(/^[-*\d.\s]+/, "").trim().slice(0, 360);
                    if (!text) return;
                    setMemoryBusy(true);
                    void fetch("/api/project-memory", {
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
                        const data = await res.json() as { fact?: { id: string; text: string }; error?: string };
                        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
                        if (data.fact) setMemoryFacts((prev) => [data.fact!, ...prev.filter((x) => x.id !== data.fact!.id)]);
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
        </div>
      )}

      {saveErrorBlock}
    </>
  );

  const agentAdvisorPanel = (
    <>
      {sectionTitle(t("settings.advisorSection"))}

      <SettingsRow
        title={t("settings.advisor")}
        description={t("settings.advisorDesc")}
        action={
          <SettingsToggle
            enabled={prefs.advisorEnabled}
            onChange={(next) => {
              setPrefs((p) => ({ ...p, advisorEnabled: next }));
              void patchPref({ advisorEnabled: next });
            }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.advisorModel")}
        description={t("settings.advisorModelDesc")}
        action={
          <select
            className="input-base input-mono"
            value={advisorModelRef}
            disabled={loadingModels || !prefs.advisorEnabled}
            onChange={(e) => {
              const value = e.target.value;
              setAdvisorModelRef(value);
              void patchPref({ advisorModel: value || null });
            }}
            style={{ width: "100%" }}
          >
            <option value="">{loadingModels ? t("common.loading") : t("settings.advisorModelDefault")}</option>
            {models.map((m) => {
              const ref = modelValue(m.provider, m.modelId);
              return (
                <option key={ref} value={ref}>{m.name} · {m.provider}</option>
              );
            })}
            {advisorModelRef && !models.some((m) => modelValue(m.provider, m.modelId) === advisorModelRef) && (
              <option value={advisorModelRef}>{advisorModelRef} ({t("settings.modelUnavailable")})</option>
            )}
          </select>
        }
      />

    </>
  );

  const generalAboutPanel = (
    <>
      {isDesktop && (
        <>
          {sectionTitle(t("settings.desktopSection"))}
          <SettingsRow
            title={t("settings.disableGpu")}
            description={t("settings.disableGpuDesc")}
            action={
              <SettingsToggle
                enabled={prefs.disableHardwareAcceleration}
                onChange={(next) => void patchPref({ disableHardwareAcceleration: next }, { restart: true })}
              />
            }
          />
        </>
      )}

      {sectionTitle(t("settings.updatesSection"))}
      <SettingsRow
        title={t("settings.autoCheckUpdates")}
        description={t("settings.autoCheckUpdatesDesc")}
        action={
          <SettingsToggle
            enabled={prefs.autoCheckUpdates}
            onChange={(next) => void patchPref({ autoCheckUpdates: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.autoDownloadUpdates")}
        description={t("settings.autoDownloadUpdatesDesc")}
        action={
          <SettingsToggle
            enabled={prefs.autoDownloadUpdates}
            onChange={(next) => void patchPref({ autoDownloadUpdates: next })}
          />
        }
      />

      {restartHint && (
        <div
          className="settings-status-card"
          style={{ marginTop: 14, color: "var(--text-muted)" }}
        >
          {t("settings.restartRequired")}
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
      {saveErrorBlock}
    </>
  );

  const previewCode = `const themePreview = {
  surface: "sidebar",
  accent: "#339CFF",
  contrast: 45,
};`;

  const appearancePanel = (
    <div className="settings-page-general">
      {sectionTitle(t("settings.appearanceUi"))}

      <SettingsRow
        title={t("settings.themeMode")}
        description={t("settings.themeModeDesc")}
        action={
          <div className="settings-segmented" style={{ minWidth: 220 }}>
            {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
              <SegmentedOption
                key={mode}
                active={(themeMode || appearance.themeMode) === mode}
                label={
                  mode === "light"
                    ? t("settings.themeLight")
                    : mode === "dark"
                      ? t("settings.themeDark")
                      : t("settings.themeSystem")
                }
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setThemeMode(mode, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                  void patchPref({ themeMode: mode });
                }}
              />
            ))}
          </div>
        }
      />

      <SettingsRow
        title={t("settings.uiFontSize")}
        description={t("settings.uiFontSizeDesc")}
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              className="input-base input-mono"
              type="number"
              min={12}
              max={18}
              step={1}
              value={appearance.uiFontSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const clamped = Math.min(18, Math.max(12, Math.round(n)));
                setAppearanceSnapshot({ uiFontSize: clamped });
                void patchPref({ uiFontSize: clamped });
              }}
              style={{ width: 72, textAlign: "right" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>px</span>
          </div>
        }
      />

      {sectionTitle(t("settings.appearanceCode"))}

      <SettingsRow
        stacked
        title={t("settings.codeThemeLight")}
        description={t("settings.codeThemeLightDesc")}
        action={
          <select
            className="input-base"
            value={appearance.codeThemeLight}
            onChange={(e) => void patchPref({ codeThemeLight: e.target.value as CodeThemeId })}
            style={{ width: "100%", maxWidth: 320 }}
          >
            {CODE_THEME_OPTIONS.filter((o) => o.mode === "light").map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        }
      />
      <SettingsRow
        stacked
        title={t("settings.codeThemeDark")}
        description={t("settings.codeThemeDarkDesc")}
        action={
          <select
            className="input-base"
            value={appearance.codeThemeDark}
            onChange={(e) => void patchPref({ codeThemeDark: e.target.value as CodeThemeId })}
            style={{ width: "100%", maxWidth: 320 }}
          >
            {CODE_THEME_OPTIONS.filter((o) => o.mode === "dark").map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title={t("settings.showLineNumbers")}
        description={t("settings.showLineNumbersDesc")}
        action={
          <SettingsToggle
            enabled={appearance.showCodeLineNumbers}
            onChange={(next) => void patchPref({ showCodeLineNumbers: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.wrapCodeLines")}
        description={t("settings.wrapCodeLinesDesc")}
        action={
          <SettingsToggle
            enabled={appearance.wrapCodeLines}
            onChange={(next) => void patchPref({ wrapCodeLines: next })}
          />
        }
      />
      <SettingsRow
        title={t("settings.codeFontSize")}
        description={t("settings.codeFontSizeDesc")}
        action={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              className="input-base input-mono"
              type="number"
              min={10}
              max={18}
              step={0.5}
              value={appearance.codeFontSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const clamped = Math.min(18, Math.max(10, Math.round(n * 2) / 2));
                setAppearanceSnapshot({ codeFontSize: clamped });
                void patchPref({ codeFontSize: clamped });
              }}
              style={{ width: 72, textAlign: "right" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>px</span>
          </div>
        }
      />

      {sectionTitle(t("settings.codePreview"))}
      <div className="settings-row-desc" style={{ marginBottom: 10 }}>
        {t("settings.codePreviewDesc")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {([
          {
            id: appearance.codeThemeLight,
            label: t("settings.previewLight"),
            dark: false,
          },
          {
            id: appearance.codeThemeDark,
            label: t("settings.previewDark"),
            dark: true,
            // Fixed light/dark preview chrome comes from .code-preview in globals.css.
          },
        ] as const).map((preview) => {
          const active = isDark === preview.dark;
          const themeStyle = getCodeThemeStyle(preview.id, preview.dark);
          const themeBg =
            (themeStyle["pre[class*=\"language-\"]"] as { backgroundColor?: string } | undefined)?.backgroundColor
            || (themeStyle.pre as { backgroundColor?: string } | undefined)?.backgroundColor
            || "var(--preview-code-bg)";
          return (
            <div
              key={String(preview.dark)}
              className={`code-preview ${preview.dark ? "is-dark" : "is-light"}`}
              style={{
                border: "1px solid var(--preview-chrome-border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--preview-chrome-bg)",
                overflow: "hidden",
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid var(--preview-chrome-border)",
                fontSize: 11,
                color: "var(--preview-chrome-fg)",
                background: "var(--preview-chrome-bg)",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: "var(--preview-title-fg)" }}>{preview.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                    {CODE_THEME_OPTIONS.find((o) => o.id === preview.id)?.label}
                  </span>
                </div>
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {active && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: "18px",
                        height: 18,
                        padding: "0 7px",
                        borderRadius: "var(--radius-xs)",
                        border: "1px solid var(--preview-chrome-border)",
                        color: "var(--preview-title-fg)",
                        background: "var(--preview-active-bg)",
                      }}
                    >
                      {t("settings.previewActive")}
                    </span>
                  )}
                  {!active && (
                    <span
                      style={{
                        fontSize: 10,
                        lineHeight: "18px",
                        height: 18,
                        padding: "0 7px",
                        borderRadius: "var(--radius-xs)",
                        border: "1px solid var(--preview-chrome-border)",
                        color: "var(--preview-chrome-fg)",
                      }}
                    >
                      {preview.dark ? t("settings.themeDark") : t("settings.themeLight")}
                    </span>
                  )}
                </span>
              </div>
              <div style={{ padding: 10, background: themeBg }}>
                <SyntaxHighlighter
                  language="typescript"
                  style={themeStyle}
                  showLineNumbers={appearance.showCodeLineNumbers}
                  wrapLongLines={appearance.wrapCodeLines}
                  customStyle={{
                    margin: 0,
                    padding: "10px 12px",
                    fontSize: appearance.codeFontSize,
                    backgroundColor: themeBg,
                    borderRadius: "var(--radius-xs)",
                  }}
                  codeTagProps={{
                    style: {
                      fontFamily: "var(--font-mono)",
                      fontSize: appearance.codeFontSize,
                      backgroundColor: "transparent",
                    },
                  }}
                >
                  {previewCode}
                </SyntaxHighlighter>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Critical layout is inlined so a CSS-load race cannot leave settings
  // flowing through the main shell (what looked like a "CSS collapse").
  const rootStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    // Warm-mounted hidden after first use / idle warmup: stays in the React
    // tree (state + fetched data survive) but paints nothing.
    display: visible ? "flex" : "none",
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
  // Content pages scroll here; dual-pane models/skills manage their own overflow.
  const mainScrolls = section !== "models" && section !== "skills";

  const toolsPanel = (
    <div className="settings-page-general">
      {sectionTitle(t("settings.lsp"))}
      <div className="settings-row-desc" style={{ marginBottom: 12 }}>
        {t("settings.lspDesc")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {lspMeta
            ? t("settings.lspAvailable", { count: lspMeta.availableCount, total: lspMeta.total })
            : lspLoading
              ? "…"
              : "—"}
        </span>
        <button type="button" className="btn-ghost btn-compact" disabled={lspLoading} onClick={() => void loadLspHealth()}>
          {t("settings.lspRefresh")}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        {t("settings.lspBuiltin")}
      </div>
      {lspError && (
        <div style={{ color: "var(--destructive)", fontSize: 12, marginBottom: 12 }}>{lspError}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(lspServers ?? []).map((s) => (
          <div
            key={s.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "10px 12px",
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "var(--radius-pill)",
                  background: s.available ? "var(--success)" : "var(--text-dim)",
                  flexShrink: 0,
                }}
              />
              <strong style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</strong>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{s.id}</span>
              {!s.available && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("settings.lspMissing")}</span>
              )}
            </div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 6, wordBreak: "break-all" }}>
              {s.available ? (s.resolvedPath ?? s.command) : s.command}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
              {s.languages.join(", ")}
            </div>
            {!s.available && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <code
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      background: "var(--bg-subtle)",
                      padding: "4px 8px",
                      borderRadius: "var(--radius-xs)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      maxWidth: "100%",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {s.install}
                  </code>
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={async () => {
                      // Always copy the platform-resolved primary command (never force brew on Windows).
                      const text = s.install;
                      try {
                        await navigator.clipboard.writeText(text);
                        setLspCopiedId(s.id);
                        window.setTimeout(() => setLspCopiedId((id) => (id === s.id ? null : id)), 1500);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    {lspCopiedId === s.id ? t("settings.lspCopied") : t("settings.lspCopyInstall")}
                  </button>
                </div>
                {s.installTip && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                    {s.installTip}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!lspLoading && lspServers && lspServers.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>—</div>
        )}
      </div>
    </div>
  );
  const mainStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: mainScrolls ? "auto" : "hidden",
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
              borderRadius: 0,
              borderRight: "1px solid var(--border)",
              padding: "0 12px",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Icon icon={ChevronLeft} size={14} />
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
          {navGroups.map((group, groupIndex) => (
            <div key={group.label} className="settings-page-nav-group">
              {!isMobile && (
                <div
                  className="settings-page-nav-label"
                  style={groupIndex > 0 ? { paddingTop: 14 } : undefined}
                >
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-page-nav-item${active ? " is-active" : ""}`}
                    disabled={item.disabled}
                    title={item.title}
                    onMouseEnter={() => {
                      if (item.id === "usage") prefetchUsage(30);
                    }}
                    onClick={() => setSection(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <main className={`settings-page-main${mainScrolls ? " is-scroll" : ""}`} style={mainStyle}>
          {section === "general" && (
            <div className="settings-page-general">
              {generalHeadPanel}
              {generalSystemPanel}
              {generalAboutPanel}
            </div>
          )}
          {section === "agent" && (
            <div className="settings-page-general">
              {agentModelsPanel}
              {agentBehaviorPanel}
              {agentAdvisorPanel}
            </div>
          )}
          {section === "memory" && (
            <div className="settings-page-general">
              {memoryPanel}
            </div>
          )}
          {section === "network" && (
            <div className="settings-page-general">
              {networkPanel}
            </div>
          )}
          {section === "usage" && <UsagePanel />}
          {section === "appearance" && appearancePanel}
          {section === "models" && (
            <ModelsConfig
              embedded
              onClose={() => {
                onModelsChanged?.();
              }}
              onModelsChanged={onModelsChanged}
            />
          )}
          {section === "skills" && cwd && (
            <SkillsConfig embedded cwd={cwd} onClose={onClose} />
          )}
          {section === "skills" && !cwd && (
            <div className="settings-page-empty">
              {t("settings.skillsNeedCwd")}
            </div>
          )}
          {section === "mcp" && (
            <McpConfig embedded cwd={cwd} onClose={onClose} />
          )}
          {section === "tools" && toolsPanel}
        </main>
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(page, document.body);
}
